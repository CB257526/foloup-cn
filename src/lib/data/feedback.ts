import { getDb } from "@/lib/db";

/**
 * feedback 表的服务端仓储（SQLite）。
 * 只能在服务端组件 / Server Action / Route Handler 中 import。
 */

export type FeedbackRow = {
  id: number;
  created_at: string;
  interview_id: string | null;
  email: string | null;
  feedback: string | null;
  satisfaction: number | null;
};

export async function submitFeedback(
  payload: Record<string, unknown>,
): Promise<FeedbackRow | null> {
  const row = {
    interview_id: payload.interview_id ?? null,
    email: payload.email ?? null,
    feedback: payload.feedback ?? null,
    satisfaction: payload.satisfaction ?? null,
  };

  const result = getDb()
    .prepare(
      `INSERT INTO feedback (interview_id, email, feedback, satisfaction)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      row.interview_id as string | null,
      row.email as string | null,
      row.feedback as string | null,
      row.satisfaction as number | null,
    );

  const created = getDb()
    .prepare("SELECT * FROM feedback WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as FeedbackRow | undefined;

  return created ?? null;
}
