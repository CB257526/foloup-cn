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
