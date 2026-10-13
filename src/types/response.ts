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
  proctoring?: {
    enabled: boolean;
    interval_seconds: number;
    confidence_threshold: number;
    strike_count: number;
    terminated: boolean;
    captures?: Array<Record<string, unknown>>;
    events?: Array<Record<string, unknown>>;
    serviceEvents?: Array<Record<string, unknown>>;
  };
}

/** 候选人结束面试时允许提交的原因；最终原因仍由服务端校正。 */
export type CallEndReason =
  | "candidate_ended"
  | "time_up"
  | "connection_closed"
  | "proctoring_terminated"
  | "error";

/** 实时语音接通后的服务端开始结果。 */
export interface CallSessionStartResult {
  response: unknown;
  started: boolean;
  alreadyStarted: boolean;
  startedAt: string | null;
  expiresAt: string | null;
  proctoring: {
    enabled: boolean;
    token: string;
    intervalSeconds: number;
    confidenceThreshold: number;
  };
  analysisToken: string;
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
  camera_monitoring_accepted: boolean;
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
}

export interface FeedbackData {
  interview_id: string;
  satisfaction: number | null;
  feedback: string | null;
  email: string | null;
}
