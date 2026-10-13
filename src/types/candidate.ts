import type { Question } from "@/types/interview";

/** HR 工作台内使用的候选人记录；简历全文只在服务端仓储解密后读取。 */
export interface CandidateInvite {
  id: string;
  interview_id: string;
  name: string;
  email: string;
  resume_file_name: string;
  resume_text: string;
  candidate_description: string;
  questions: Question[];
  invite_token: string;
  status: "ready" | "in_progress" | "completed" | "revoked";
  consent_version: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  revoked_at: string | null;
  call_id: string | null;
}

/** 候选人专属链接只返回面试所需字段，禁止把简历全文发送到候选人浏览器。 */
export interface PublicCandidateInvite {
  id: string;
  interview_id: string;
  name: string;
  email: string;
  resume_file_name: string;
  candidate_description: string;
  questions: Question[];
  status: "ready" | "in_progress" | "completed" | "revoked";
  consent_version: string | null;
  /**
   * 服务端「当前有效」的同意文案版本（由数据层注入，不接受客户端提交）。
   *
   * 浏览器拿它和 `consent_version` 对比：只有两者一致才认为候选人已同意**当前文案**；
   * 不一致（文案改过版）时必须重新走一遍同意环节 —— 旧版本的同意不能当新版本用。
   */
  required_consent_version: string;
  started_at: string | null;
  completed_at: string | null;
  revoked_at: string | null;
}

export interface CreateCandidateInviteInput {
  interviewId: string;
  name: string;
  email: string;
  resumeFileName: string;
  resumeText: string;
  candidateDescription: string;
  questions: Question[];
}

/**
 * 候选人提交同意时**允许**携带的字段白名单。
 *
 * ⚠️ 这里刻意不包含姓名、邮箱、candidate_id 与 interview_id：
 *    候选人身份必须由服务端从专属令牌（`token`）解析，不能相信浏览器提交的身份字段。
 *    user-agent 也不在这里 —— 服务端直接从请求头取，客户端传什么都不作数（防止塞入密钥/任意文本）。
 */
export type ConsentSubmitInput = {
  /** 候选人专属链接的随机令牌（URL 段） */
  token: string;
  /** 候选人看到的同意文案版本（服务端会与当前版本比对，不一致直接拒绝） */
  consentVersion: string;
  /** ①（必选）单独同意：语音上传至国内大模型语音服务，用于实时识别与语音合成 */
  voiceProcessingAccepted: boolean;
  /** ②（必选）同意生成文字转录与 AI 初筛评分，并已知悉保存期限/可见范围/删除方式 */
  evaluationAccepted: boolean;
  /** ③（可选）去标识化后用于改进面试流程 */
  improvementAccepted: boolean;
};

/** 同意留痕的写入结果。duplicate=true 表示该（候选人 + 岗位 + 文案版本）此前已有记录。 */
export type ConsentSubmitResult = {
  id: number;
  createdAt: string;
  /** true = 复用了已存在的审计记录，没有产生第二条 */
  duplicate: boolean;
  /** true = 复用记录的同时更新了同意项（例如后补勾选了可选项） */
  updated: boolean;
};

/** 候选人页需要的同意策略（服务端权威值，避免客户端各自写一份版本号）。 */
export type ConsentPolicy = {
  /** 当前有效同意文案版本 */
  version: string;
  /** 留存期限（自然月） */
  retentionMonths: number;
};
