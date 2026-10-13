import { getRuntimeAppSettings } from "@/lib/data/settings";

/**
 * 平台 LLM 调用封装（qianwenai，OpenAI 兼容协议）。
 *
 * ── 为什么有这个文件 ──────────────────────────────────────────────
 * 原版 FoloUp 有 4 处直接 `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`
 * （1 个 service + 3 个 API 路由）。改造后统一走这里，好处：
 *   1. 地址 / 模型名 / token 上限全部由一个地方读环境变量 —— 用户可随时切换模型；
 *   2. 平台特有的坑只在一处防（见下方 ⚠️）；
 *   3. 换供应商（甚至换成别的兼容协议服务）只需改这一个文件。
 *
 * ── 环境变量（全部可选，带默认值；不配也能跑）───────────────────────
 *   LLM_BASE_URL     默认 https://dashscope.aliyuncs.com/compatible-mode/v1
 *   LLM_API_KEY      平台密钥（必填，否则运行时报错并给出提示）
 *   LLM_MODEL        默认 deepseek-v4.1-flash（1 元/百万 tok，最便宜）
 *   LLM_MAX_TOKENS   默认 4000（⚠️ 不要低于 2000，见下）
 *   LLM_TIMEOUT_MS   默认 50000
 *   LLM_JSON_MODE    默认 "1"（总开关）。设 "0" 则**永不**发 response_format，
 *                    靠提示词与 extractJson 兜底 —— 万一换到不支持 json_object 的模型可用它兜底。
 *
 * ── ⚠️ 坑 1：思考过程会吃掉 max_tokens，正文变空（实测数据见 probe/p2_llm_probe.py）──
 * `deepseek-v4` 系列（含默认的 v4.1-flash）与 `glm-5` 会先输出 `reasoning_content`（思考过程），
 * **max_tokens 是思考+正文共享的预算**。实测 deepseek-v4.1-flash：
 *     max_tokens=10  → 思考 24 字、正文 0 字、finish_reason=length
 *     max_tokens=200 → 思考 361 字、正文 0 字、finish_reason=length   ← 200 也不够！
 *     max_tokens=2000→ 思考 303 字、正文 49 字、finish_reason=stop
 * 即「HTTP 200 + 正文为空」不是接口不通，是预算被思考吃光了。
 * 本文件对此做了两件事：默认 4000；**一旦发现正文为空就明确报错并提示调大 max_tokens**，
 * 避免下一个人又把它误判成「接口假通」。
 *
 * ── ⚠️ 坑 2：`response_format: json_object` 要求 messages 里出现 "json" 字样 ──
 * 平台实测（P2 发现，交接文档未记录）：提示词里没有 "json" 二字时直接 HTTP 400：
 *   `'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'`
 * 所以本文件**不默认发 response_format**：由调用方显式 `json: true` 声明，且声明时会自动
 * 检查提示词、缺 "json" 字样就补一句约束，防止调用方踩这个 400。
 *
 * ── 只能在服务端用 ───────────────────────────────────────────────
 * 本文件会读 `LLM_API_KEY`，客户端组件**不要** import 它（否则密钥会被打进浏览器包）。
 * 这里没有写 `import "server-only"`：该包在本项目只是 @clerk 的传递依赖，
 * 而 Clerk 已被移除 —— 引用它会让 tsc 报「找不到模块」。
 */

const DEFAULT_TIMEOUT_MS = 50_000;

/** 平台实测可用模型（备查，实际用哪个由 LLM_MODEL 决定） */
export const KNOWN_LLM_MODELS = [
  "deepseek-v4.1-flash",
  "deepseek-v4-pro",
  "qwen3.8-max",
  "qwen-max",
  "glm-5",
  "kimi-k2.6",
  "MiniMax/MiniMax-M2.7",
] as const;

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  /** response_format 总开关（LLM_JSON_MODE=0 可全局关掉） */
  jsonAllowed: boolean;
}

/** 每次调用都重新读环境变量，切换模型不需要重启构建（dev 下改 .env 重启即可生效） */
export function getLlmConfig(overrides?: Partial<LlmConfig>): LlmConfig {
  const settings = getRuntimeAppSettings();
  const config: LlmConfig = {
    baseUrl: settings.llmBaseUrl.replace(/\/+$/, ""),
    // 平台密钥统一由服务端设置仓储读取，旧部署仍可使用环境变量回退。
    apiKey: settings.apiKey,
    model: settings.llmModel,
    maxTokens: settings.llmMaxTokens,
    timeoutMs: settings.llmTimeoutMs || DEFAULT_TIMEOUT_MS,
    jsonAllowed: settings.llmJsonMode,
  };
  return { ...config, ...overrides };
}

type ChatMessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
}

interface ChatCompletionChoice {
  message?: { content?: string | null; reasoning_content?: string | null };
  finish_reason?: string;
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface ChatCompletionParams {
  /** 单条 system 提示词 */
  system: string;
  /** 单条 user 提示词 */
  user: string;
  /**
   * 是否要求模型输出 JSON（会发 `response_format: {"type":"json_object"}`）。
   * ⚠️ 平台要求 messages 里出现 "json" 字样，否则 400；本函数会自动检查并补齐，调用方不必操心。
   */
  json?: boolean;
  /** 覆盖默认模型（一般不用，留给需要按场景选模型的场合） */
  model?: string;
  /** 覆盖 token 上限（⚠️ 不要低于 2000） */
  maxTokens?: number;
  /** 可选的图片 data URL；传入后会把 user 消息组装成图文内容。 */
  imageDataUrl?: string;
  /** 重试次数（网络错误 / 429 / 5xx 才重试；4xx 直接失败） */
  retries?: number;
  /** 测试连接等服务端调用可使用尚未保存的设置，但参数不会传到浏览器。 */
  config?: Partial<LlmConfig>;
}

/** 平台约束：用 response_format=json_object 时，messages 里必须出现 "json" */
const JSON_HINT = "\n\n请只输出合法的 JSON，不要输出任何解释或多余文字。";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 调一次平台 LLM，返回**正文**（`message.content`，已 trim）。
 *
 * 失败时抛 `Error`，错误信息带可操作提示（尤其是「正文为空」这条）。
 * 调用方自己决定 try/catch 还是让它冒泡。
 */
export async function chatCompletion({
  system,
  user,
  json,
  model,
  maxTokens,
  imageDataUrl,
  retries = 2,
  config: configOverrides,
}: ChatCompletionParams): Promise<string> {
  const config = getLlmConfig(configOverrides);

  if (!config.apiKey) {
    throw new Error(
      "[LLM] 未配置平台 API 密钥。请在系统设置中配置，或在服务端环境变量 LLM_API_KEY / QWEN_API_KEY 中提供。",
    );
  }

  const useModel = model || config.model;
  const useMaxTokens = maxTokens || config.maxTokens;
  const useJsonMode = (json ?? false) && config.jsonAllowed;

  // ⚠️ 平台要求：走 response_format=json_object 时 messages 里必须有 "json" 字样，
  //    否则 400。这里缺就自动补，避免调用方因为提示词少写一个词而整条链路挂掉。
  let userPrompt = user;
  if (useJsonMode && !/json/i.test(`${system}\n${user}`)) {
    userPrompt = `${user}${JSON_HINT}`;
  }

  const payload: Record<string, unknown> = {
    model: useModel,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: imageDataUrl
          ? [
              { type: "image_url", image_url: { url: imageDataUrl } },
              { type: "text", text: userPrompt },
            ]
          : userPrompt,
      },
    ] satisfies ChatMessage[],
    max_tokens: useMaxTokens,
  };
  // 实测平台支持 response_format: json_object（deepseek-v4 系列 / qwen / glm-5 / kimi 全部通过）
  if (useJsonMode) payload.response_format = { type: "json_object" };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(800 * attempt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store",
      });

      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 500);
        const err = new Error(
          `[LLM] ${useModel} 返回 HTTP ${res.status}：${detail}` +
            (res.status === 404
              ? "（模型名可能不对；MiniMax 类模型需要带命名空间前缀，如 MiniMax/MiniMax-M2.7）"
              : ""),
        );
        // 429 / 5xx 值得重试；其余直接失败，避免白等
        if (res.status === 429 || res.status >= 500) {
          lastError = err;
          continue;
        }
        throw err;
      }

      const data = (await res.json()) as ChatCompletionResponse;
      const choice = data.choices?.[0];
      const content = (choice?.message?.content || "").trim();
      const reasoning = (choice?.message?.reasoning_content || "").trim();

      if (!content) {
        // ⚠️ 平台特有的失败形态：HTTP 200，但正文空、思考有一大段。
        // 这不是「接口不通」，是 max_tokens 被思考过程吃光了。
        throw new Error(
          `[LLM] ${useModel} 返回 200 但正文为空` +
            (reasoning
              ? `（思考过程 ${reasoning.length} 字被吃进 max_tokens，finish_reason=${choice?.finish_reason}）`
              : "（未返回任何内容）") +
            `。当前 max_tokens=${useMaxTokens}，请调大（建议 ≥4000，绝不低于 2000）：` +
            "在 .env 里设 LLM_MAX_TOKENS，或调用处传 maxTokens。",
        );
      }

      // 更隐蔽的一种：正文有内容，但被 max_tokens 截断 → JSON 不完整，
      // 下游只会看到「JSON 解析失败」这种误导性报错。这里提前点明真实原因。
      if (useJsonMode && choice?.finish_reason === "length") {
        throw new Error(
          `[LLM] ${useModel} 的 JSON 输出被 max_tokens 截断（finish_reason=length；` +
            `正文 ${content.length} 字、思考 ${reasoning.length} 字，共用 ${useMaxTokens} 上限）。` +
            "推理型模型的思考过程也占预算，请调大 LLM_MAX_TOKENS 或在调用处传更大的 maxTokens。",
        );
      }

      return content;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;
      const aborted = err.name === "AbortError";
      if (aborted) {
        lastError = new Error(
          `[LLM] ${useModel} 请求超时（>${config.timeoutMs}ms）。` +
            "可调大 LLM_TIMEOUT_MS，或换更快的模型（deepseek-v4-pro / glm-5 实测明显更慢）。",
        );
      }
      // 只有超时与网络类错误才重试；语义错误（正文为空、4xx）立即抛出
      const retriable =
        aborted || /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(err.message);
      if (!retriable || attempt === retries) throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("[LLM] 未知错误");
}

/**
 * 从模型输出里取出 JSON 对象。
 *
 * 平台开了 `response_format: json_object` 后一般直接返回裸 JSON，
 * 但推理型模型偶发会包一层 ```json 围栏或前后缀说明，这里做兜底。
 */
export function extractJson<T = unknown>(raw: string): T {
  const text = (raw || "").trim();
  if (!text) throw new Error("[LLM] 待解析的 JSON 内容为空");

  const candidates: string[] = [text];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `[LLM] 无法从模型输出中解析出 JSON：${(lastError as Error)?.message ?? "unknown"}；` +
      `原文前 200 字：${text.slice(0, 200)}`,
  );
}
