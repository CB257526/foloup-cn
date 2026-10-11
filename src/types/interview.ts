export interface Question {
  id: string;
  question: string;
  follow_up_count: number;
}

export interface Quote {
  quote: string;
  call_id: string;
}

/** 建岗位表单用的字段集（单租户：已删 user_id / organization_id） */
export interface InterviewBase {
  name: string;
  /** 原版是 bigint（Postgres int8）。SQLite 无 int8，改为 number；0 表示"未选面试官" */
  interviewer_id: number;
  objective: string;
  question_count: number;
  time_duration: string;
  is_anonymous: boolean;
  questions: Question[];
  description: string;
  response_count: number;
}

export interface InterviewDetails {
  id: string;
  created_at: string;
  url: string | null;
  insights: string[];
  quotes: Quote[];
  details: any;
  is_active: boolean;
  theme_color: string;
  logo_url: string;
  respondents: string[];
  readable_slug: string;
}

export interface Interview extends InterviewBase, InterviewDetails {}
