/**
 * 面试应答相关类型（P1 · 语音层）
 *
 * 变更说明（Retell → 通义实时）：
 *   - `id`: bigint → number（Postgres int8 遗留，SQLite 无 int8；且 BigInt 无法序列化给客户端组件）
 *   - `transcript`: 新增。逐字稿**纯文本**（P0 已在 response 表加了该列），P2 的评分直接吃这一列
 *   - `CallData`: 由 Retell 通话对象改为**通义实时会话**结构（原 recording_url / e2e_latency /
 *     call_analysis 等 Retell 专属字段一并删除）
 */

export interface Response {
  id: number;
  created_at: Date;
  name: string | null;
  interview_id: string;
  duration: number;
  candidate_id?: string | null;
  call_id: string;
  /** JSON 透传：存进去什么对象就读出来什么对象，数据层不解释结构。实际内容是 CallData */
  details: any;
  is_analysed: boolean;
  email: string;
  is_ended: boolean;
  is_viewed: boolean;
  /** JSON 透传：AI 评分结果，实际内容是 Analytics */
  analytics: any;
  candidate_status: string;
  tab_switch_count: number;
  /** 逐字稿纯文本（P1 在通话结束时写入，P2 评分时读取） */
  transcript?: string | null;
  /** 服务端确认接通后的真实开始时间；历史记录可能为空。 */
  started_at?: string | null;
  /** 服务端完成动作生成的真实结束时间；历史记录可能为空。 */
  ended_at?: string | null;
  /** 服务端根据 started_at / ended_at 计算的权威时长。 */
  server_duration?: number | null;
  /** 服务端根据岗位时长计算的到期时间。 */
  expires_at?: string | null;
  /** 评分领取状态，仅供服务端防重复评分使用。 */
  analysis_status?: "idle" | "processing" | "completed" | "failed" | string;
  analysis_started_at?: string | null;
}

/** 一句话 */
export interface TranscriptTurn {
  /** agent = AI 面试官，user = 候选人 */
  role: "agent" | "user";
  content: string;
  /** 距会话开始的毫秒偏移 */
  offset_ms: number;
}

/** 一次实时语音会话的实测指标 */
export interface RealtimeStats {
  /** 每轮「用户说完 → AI 出声」的延迟样本（秒） */
  latency_samples: number[];
  latency_avg: number;
  latency_max: number;
  /** 候选人打断 AI 的次数 */
  interruption_count: number;
  /** 上行音频分片数（每片 100ms） */
  audio_chunks: number;
  /** 上行音频字节数 */
  audio_bytes: number;
}

/**
 * 通义实时会话落库结构（`response.details` 的实际内容）。
 *
 * 面试结束时由 `components/call/index.tsx` 通过 Server Action 写入。
 */
export interface CallData {
  call_id: string;
  interview_id: string;
  /** 模型名，如 qwen3.8-omni-flash-realtime */
  model: string;
  /** 音色，如 Tina */
  voice: string;
  /** 逐字稿纯文本，每行形如「AI 面试官：…… / 张三：……」 */
  transcript: string;
  /** 结构化逐字稿 */
  transcript_object: TranscriptTurn[];
  /** 结果页展示的时长，服务端新记录优先使用 server_duration。 */
  duration: number;
  /** 历史 details 可能没有这些字段，所以使用可空类型兼容旧记录。 */
  started_at?: string | null;
  ended_at?: string | null;
  server_duration?: number | null;
  /** 客户端采集的诊断时长，不具备结算权限。 */
  client_duration?: number | null;
  /** 结束原因：candidate_ended / time_up / connection_closed / error */
  end_reason: string;
  candidate_id?: string;
  interview_questions?: string[];
  stats?: RealtimeStats;
}

/** 候选人结束面试时允许提交的原因；最终原因仍由服务端校正。 */
export type CallEndReason = "candidate_ended" | "time_up" | "connection_closed" | "error";

/**
 * 结束原因的中文文案。
 *
 * 结果页与 CSV 导出共用同一份映射，避免两处各写一套导致 HR 看到不一致的说法。
 */
export const CALL_END_REASON_TEXT: Record<string, string> = {
  candidate_ended: "候选人主动结束",
  time_up: "到达面试时长上限",
  connection_closed: "语音连接中断",
  error: "通话异常结束",
};

/** 实时语音接通后的服务端开始结果。 */
export interface CallSessionStartResult {
  response: unknown;
  started: boolean;
  alreadyStarted: boolean;
  startedAt: string | null;
  expiresAt: string | null;
}

/** 服务端幂等完成结果；alreadyEnded=true 表示复用了第一次完成结果。 */
export interface CallSessionFinishResult {
  callId: string;
  startedAt: string | null;
  endedAt: string | null;
  serverDuration: number | null;
  endReason: CallEndReason;
  alreadyEnded: boolean;
  response: unknown;
}

/** 同意记录的数据库字段，先冻结类型供后续 P1/P2 使用。 */
export interface ConsentRecord {
  id: number;
  interview_id: string;
  call_id: string | null;
  candidate_email: string | null;
  candidate_name: string | null;
  consent_version: string;
  voice_processing_accepted: boolean;
  evaluation_accepted: boolean;
  improvement_accepted: boolean;
  created_at: string;
  withdrawn_at: string | null;
  user_agent: string | null;
  ip_hash: string | null;
}

/** interview.competency_dimensions 中每个 JSON 数组元素的冻结基础结构。 */
export interface CompetencyDimension {
  key: string;
  name: string;
  description?: string;
  weight?: number;
  indicators?: string[];
}

/** interview.competency_dimensions 字段在数据库中的 JSON 数组类型。 */
export type CompetencyDimensions = CompetencyDimension[];

/* ------------------------------------------------------------------ */
/* 后续 P1：结构化能力评分与证据链                                      */
/* ------------------------------------------------------------------ */

/**
 * 一条可核验的能力证据。
 *
 * `quote` 必须能在候选人（`role=user`）的逐字稿发言里**逐字找到**；
 * 服务端会把模型编造的引用直接丢弃（宁缺毋滥），因此拿不到证据时这里是空数组。
 */
export interface CompetencyEvidence {
  /** 候选人原话（逐字稿原文原句，不改写） */
  quote: string;
  /**
   * 距会话开始的毫秒偏移，来自**真实结构化逐字稿**（`transcript_object[].offset_ms`）。
   * 历史记录没有结构化逐字稿、或该轮次没有偏移时是 `null`，UI 显示「位置未知」，
   * 服务端不会让模型自己编一个看似精确的数字。
   */
  transcriptOffsetMs: number | null;
}

/** 单个岗位能力维度的评分结果。维度名来自岗位配置，模型不得新增维度。 */
export interface CompetencyScore {
  /** 维度名，与岗位 `competency_dimensions[].name` 一一对应 */
  name: string;
  /** 0-100；模型没有给出该维度时是 `null`（UI 显示「未评估」，不伪造分数） */
  score: number | null;
  /** 结论，60 字以内 */
  feedback: string;
  /** 通过服务端校验的证据 */
  evidence: CompetencyEvidence[];
  /** 风险提示，如「缺少量化结果」 */
  riskFlags: string[];
  /**
   * 服务端规范化后的证据状态：
   *   matched = 至少有一条引用在候选人逐字稿里核对通过
   *   missing = 没有可用证据（模型没给、或给的引用核对不上），UI 显示「缺少证据」
   */
  evidenceStatus?: "matched" | "missing";
}

/** 评分失败的可操作原因分类，用于给 HR 明确的中文提示。 */
export type AnalysisFailureCode =
  | "no_api_key"
  | "empty_output"
  | "truncated"
  | "invalid_json"
  | "invalid_structure"
  | "timeout"
  | "unknown";

/** 最近一次评分失败的原因（保存在 `response.details.diagnostics.analysis_error`）。 */
export interface AnalysisErrorInfo {
  code: AnalysisFailureCode;
  message: string;
  at?: string;
}

/** 结果页要区分的评分状态：未开始 / 评分中 / 已成功 / 已失败 / 没有配置模型密钥。 */
export type AnalysisStatus = "idle" | "processing" | "completed" | "failed" | "no_api_key";

export interface Analytics {
  overallScore: number;
  overallFeedback: string;
  communication: { score: number; feedback: string };
  generalIntelligence: string;
  softSkillSummary: string;
  questionSummaries: Array<{
    question: string;
    summary: string;
  }>;
  /**
   * 后续 P1 新增：按岗位能力维度输出的结构化评分与证据。
   *
   * ⚠️ 刻意保持**可选**：P2 之前落库的历史记录只有 `overallScore` 等旧字段，
   * 结果页必须继续能打开，并且**不能**给它们编造能力分（见 进度/后续P1-结果工作台-2026-10-13.md）。
   */
  competencyScores?: CompetencyScore[];
  /** 本次评分实际使用的维度名单（按岗位配置顺序），便于 HR 核对。 */
  competencyDimensionNames?: string[];
}

/** 结果读取接口在评分失败时返回的中文可操作提示。 */
export interface AnalysisFailureHint {
  code: AnalysisFailureCode;
  message: string;
}

/**
 * 评分失败原因 → HR 能照着做的中文提示。
 *
 * 放在这里（纯数据、无依赖）而不是服务端数据层，是因为**服务端要存、客户端要显示**：
 *   - 服务端：`lib/data/analytics.ts` 用它生成 `details.diagnostics.analysis_error`；
 *   - 客户端：`components/call/callInfo.tsx` 读回后直接展示（客户端组件不能 import 服务端数据层）。
 */
export const ANALYSIS_FAILURE_TEXT: Record<AnalysisFailureCode, string> = {
  no_api_key:
    "尚未配置大模型 API 密钥，无法评分。请先在系统设置中配置平台密钥，然后点击「重新评分」。",
  empty_output:
    "模型没有返回正文（常见原因是 max_tokens 被思考过程吃光）。可调大 LLM_MAX_TOKENS 或换更快的模型后「重新评分」。",
  truncated: "模型的 JSON 输出被 max_tokens 截断。请调大 LLM_MAX_TOKENS 后「重新评分」。",
  invalid_json: "模型没有返回可解析的 JSON。可点击「重新评分」重试，或更换模型。",
  invalid_structure: "模型返回的评分结构不完整（缺少总体评分等必需字段）。请点击「重新评分」。",
  timeout: "评分请求超时。可调大 LLM_TIMEOUT_MS 或换更快的模型后「重新评分」。",
  unknown: "评分失败，请点击「重新评分」重试。",
};

/** 把失败信息翻译成中文提示；没有具体原因时给通用提示。 */
export function describeAnalysisFailure(error: AnalysisErrorInfo | null): string {
  if (!error) {
    return ANALYSIS_FAILURE_TEXT.unknown;
  }
  const known = ANALYSIS_FAILURE_TEXT[error.code];

  return known ?? (error.message || ANALYSIS_FAILURE_TEXT.unknown);
}

/**
 * 结果页统一展示的合规提示。
 *
 * AI 初筛结论可能出错、也可能涉及就业歧视举证，必须让 HR 明确"这只是一个辅助信号"。
 */
export const ALERT_NOTE = "AI 评分仅辅助初筛，最终由人工判断。";

/**
 * 引文匹配用的归一化：去掉空白与常见中英文标点、忽略大小写。
 *
 * 服务端用它核对模型给的 `evidence.quote` 是否真的出自候选人发言；
 * 结果页用它把同一段引文定位回结构化逐字稿的对应轮次。
 * **两处必须用同一套规则**，否则会出现"服务端说证据有效、界面却定位不到"。
 */
export function normalizeTranscriptForMatch(text: string): string {
  return text
    .replace(/[\s，。、；：？！,.;:?!"'“”‘’()（）【】\[\]{}—…~～·<>《》]/g, "")
    .toLowerCase();
}

export interface FeedbackData {
  interview_id: string;
  satisfaction: number | null;
  feedback: string | null;
  email: string | null;
}
