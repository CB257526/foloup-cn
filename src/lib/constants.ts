/**
 * 面试官人设 + 实时语音常量（P1 · 语音层）
 *
 * 全部参数来自 `POC验证报告.md` / `交接文档.md` 第 6 节的**实测结果**，不要凭 OpenAI 官方文档改动。
 *
 * ⚠️ 三个已踩过的坑（改这个文件前必读）：
 *   1. 音色填错会**直接掐断 WebSocket**（不是返回错误）。下面 REALTIME_VOICES 的 9 个是实测可用的全部音色。
 *      Cherry / Ethan / Chelsie 只在普通 TTS 上可用，实时模型上不支持。
 *   2. modalities 只能是 ["text","audio"] 或 ["text"]；写 ["audio"] 会被服务端掐断（close 1007）。
 *   3. 空 `response.create` 会返回 error（不掐连接）：Cannot create response without input, history, or instructions。
 *      让 AI 主动开场必须带 `response.instructions`。
 */

/** 实时语音模型（性价比最优，见 POC 报告 §5.2） */
export const REALTIME_MODEL = "qwen3.8-omni-flash-realtime";

/** 候选人语音转写模型 */
export const REALTIME_ASR_MODEL = "qwen3-asr-flash-realtime";

/** 实时语音 WebSocket 基址（浏览器直连，api_key 走查询参数，不需要自建中转服务） */
export const REALTIME_WS_BASE = "wss://maas.qianwenaiapi.com/api-ws/v1/realtime";

/** 实测可用的全部音色 —— 填错会直接断连，新增前必须先实测 */
export const REALTIME_VOICES = [
  "Tina",
  "Serena",
  "Dylan",
  "Sunny",
  "Eric",
  "Momo",
  "Kiki",
  "Jennifer",
  "Ryan",
] as const;

export type RealtimeVoice = (typeof REALTIME_VOICES)[number];

/** 默认音色（平台默认值） */
export const DEFAULT_VOICE: RealtimeVoice = "Tina";

/**
 * 面试时长的统一规则。
 *
 * 旧版本把默认值写成 1 分钟，并且创建岗位时把上限限制在 10 分钟；
 * 这会导致历史数据或保存失败时，候选人页面悄悄按 1 分钟结束。
 * 公司内部初筛默认采用 20 分钟，同时保留 1 分钟的快速验证能力，
 * 允许正式面试最长 60 分钟。
 */
export const DEFAULT_INTERVIEW_DURATION_MINUTES = 20;
export const MAX_INTERVIEW_DURATION_MINUTES = 60;

/** 将来自表单、旧数据库或接口的时长统一为可靠的整数分钟。 */
export function normalizeInterviewDuration(value: unknown): string {
  const minutes = Number(value);
  if (Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_INTERVIEW_DURATION_MINUTES) {
    return String(minutes);
  }

  return String(DEFAULT_INTERVIEW_DURATION_MINUTES);
}

/**
 * 面试官主提示词（原 `RETELL_AGENT_GENERAL_PROMPT`，改为中文）。
 *
 * 占位符由 `api/register-call` 在签发会话时替换：
 *   {{mins}} {{name}} {{objective}} {{questions}}
 */
export const INTERVIEWER_GENERAL_PROMPT = `你是本次面试的 AI 面试官，用中文口语与候选人交流。

面试基本信息：
- 面试总时长控制在 {{mins}} 分钟以内，接近时长时自然收尾。
- 候选人姓名：{{name}}
- 本次面试目标：{{objective}}
- 可参考的问题（不必照读，可自然改写，已经问过的不要重复）：
{{questions}}

对话要求：
- 全程使用中文，语气专业但不失亲切，像真人面对面聊天。
- 每次发言控制在两句话以内，不要长篇大论。
- 候选人回答后，先简短回应他说的具体内容，再追问一个能挖得更深的相关问题。
- 只围绕面试目标提问，不要聊与岗位无关的话题。
- 候选人跑题、答非所问或长时间沉默时，自然地把他拉回面试主线。
- 如果候选人明确表示回答不上来，换个角度再问一次，仍答不上来就换下一题。`;

/** 让 AI 主动开场的指令（response.create 时作为 response.instructions 下发） */
export const INTERVIEW_GREETING = `面试正式开始。请用一句中文问候候选人（若知道姓名请带上姓名），并简要说明本次面试的岗位与目标，然后问出第一个问题。控制在三句话以内。`;

type InterviewerSeed = {
  name: string;
  rapport: number;
  exploration: number;
  empathy: number;
  speed: number;
  image: string;
  description: string;
  audio: string;
  /** 该人设使用的实时音色（必须是 REALTIME_VOICES 之一，否则会被服务端掐断连接） */
  voice: RealtimeVoice;
};

/**
 * 两个默认面试官（用户已决定保留两个，改成中文人设）。
 *
 * 注意：`app/actions/interviewers.ts` 用 `Object.values()` 取种子建库，
 * 只取 name/description/image/audio/empathy/exploration/rapport/speed 八个字段，
 * 新增的 voice 字段不会被写进数据库 —— 音色按**姓名**在 `getVoiceForInterviewer` 里查。
 */
export const INTERVIEWERS: Record<string, InterviewerSeed> = {
  LISA: {
    name: "探索官 李薇",
    rapport: 7,
    exploration: 10,
    empathy: 7,
    speed: 5,
    image: "/interviewers/Lisa.png",
    audio: "Lisa.wav",
    voice: "Serena",
    description:
      "你好，我是李薇。我是一位善于追问的面试官，喜欢把一件事挖到根上。我会先听你把话说完，再顺着细节往下问，帮你把真正做过的事情讲清楚。我们开始吧。",
  },
  BOB: {
    name: "倾听官 王博",
    rapport: 7,
    exploration: 7,
    empathy: 10,
    speed: 5,
    image: "/interviewers/Bob.png",
    audio: "Bob.wav",
    voice: "Dylan",
    description:
      "你好，我是王博。我是一位偏向倾听的面试官，更在意你做一件事时的判断和感受。别紧张，按你自己的节奏讲就好，我会跟着你的回答往下聊。我们开始吧。",
  },
};

/**
 * 按面试官姓名查音色（数据库里不存 voice 列，只能按姓名匹配）。
 * 查不到就回落默认音色 —— 回落总好过填错被掐断连接。
 */
export function getVoiceForInterviewer(name?: string | null): RealtimeVoice {
  if (name) {
    for (const seed of Object.values(INTERVIEWERS)) {
      if (seed.name === name) {
        return seed.voice;
      }
    }
  }

  return DEFAULT_VOICE;
}
