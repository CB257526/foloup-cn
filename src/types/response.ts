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
  /** 会话时长（秒） */
  duration: number;
  started_at: string;
  ended_at: string;
  /** 结束原因：candidate_ended / time_up / connection_closed / error */
  end_reason: string;
  stats: RealtimeStats;
}

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
