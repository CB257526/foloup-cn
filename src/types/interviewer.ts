export interface Interviewer {
  id: number;
  created_at: string;
  name: string;
  rapport: number;
  exploration: number;
  empathy: number;
  speed: number;
  image: string;
  description: string;
  audio: string;
  /** Retell 残留字段：等 P1 删掉 `api/register-call` 后可一并删除此列 */
  agent_id: string;
}
