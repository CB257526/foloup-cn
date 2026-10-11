import { fromBoolCol, fromJsonCol, getDb, toBoolCol, toJsonCol } from "@/lib/db";

/**
 * response 表的服务端仓储（SQLite）。
 * 只能在服务端组件 / Server Action / Route Handler 中 import。
 *
 * ⚠️ 对外约定（已冻结，见 进度/P0-地基-数据层与构建.md 第 4 节）：
 * `details` / `analytics` 是 **JSON 透传** —— 存进去什么对象，读出来还是什么对象，
 * 数据层不解释其内部结构。P1 可以在 types/response.ts 里随意改这两个字段的类型。
 */

export type ResponseRow = {
  id: number;
  created_at: string;
  interview_id: string | null;
  name: string | null;
  email: string | null;
  call_id: string | null;
  candidate_status: string | null;
  duration: number | null;
  transcript: string | null;
  details: unknown;
  analytics: unknown;
  is_analysed: boolean;
  is_ended: boolean;
  is_viewed: boolean;
  tab_switch_count: number | null;
};

const JSON_COLS = ["details", "analytics"] as const;
const BOOL_COLS = ["is_analysed", "is_ended", "is_viewed"] as const;
const PLAIN_COLS = [
  "interview_id",
  "name",
  "email",
  "call_id",
  "candidate_status",
  "duration",
  "transcript",
  "tab_switch_count",
] as const;

type SqliteBinding = string | number | bigint | Buffer | null;

function toRow(payload: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  for (const col of PLAIN_COLS) {
    if (payload[col] !== undefined) {
      row[col] = payload[col];
    }
  }
  for (const col of JSON_COLS) {
    if (payload[col] !== undefined) {
      row[col] = toJsonCol(payload[col]);
    }
  }
  for (const col of BOOL_COLS) {
    if (payload[col] !== undefined) {
      row[col] = toBoolCol(payload[col]);
    }
  }

  return row;
}

function fromRow(row: unknown): ResponseRow | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const r = row as Record<string, any>;

  return {
    ...r,
    details: fromJsonCol<unknown>(r.details, null),
    analytics: fromJsonCol<unknown>(r.analytics, null),
    is_analysed: fromBoolCol(r.is_analysed),
    is_ended: fromBoolCol(r.is_ended),
    is_viewed: fromBoolCol(r.is_viewed),
  } as unknown as ResponseRow;
}

/** 返回新插入行的 id（供 P1 建通话时回读） */
export async function createResponse(payload: Record<string, unknown>): Promise<number | null> {
  const row = toRow(payload);
  const cols = Object.keys(row);

  if (cols.length === 0) {
    return null;
  }

  const sql = `INSERT INTO response (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  const values = cols.map((c) => row[c]) as SqliteBinding[];
  const result = getDb().prepare(sql).run(...values);

  return Number(result.lastInsertRowid);
}

export async function saveResponse(
  payload: Record<string, unknown>,
  callId: string,
): Promise<void> {
  const row = toRow(payload);
  const cols = Object.keys(row).filter((c) => c !== "call_id");

  if (cols.length === 0) {
    return;
  }

  const sql = `UPDATE response SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE call_id = ?`;
  const values = cols.map((c) => row[c]) as SqliteBinding[];
  getDb()
    .prepare(sql)
    .run(...values, callId);
}

export async function updateResponse(
  payload: Record<string, unknown>,
  callId: string,
): Promise<void> {
  return saveResponse(payload, callId);
}

export async function getAllResponses(interviewId: string): Promise<ResponseRow[]> {
  try {
    const rows = getDb()
      .prepare(
        "SELECT * FROM response WHERE interview_id = ? AND is_ended = 1 ORDER BY created_at DESC, rowid DESC",
      )
      .all(interviewId);

    return rows.map(fromRow).filter(Boolean) as ResponseRow[];
  } catch (error) {
    console.error("[data/responses] getAllResponses failed:", error);

    return [];
  }
}

export async function getResponseByCallId(callId: string): Promise<ResponseRow | null> {
  try {
    const row = getDb().prepare("SELECT * FROM response WHERE call_id = ? LIMIT 1").get(callId);

    return fromRow(row);
  } catch (error) {
    console.error("[data/responses] getResponseByCallId failed:", error);

    return null;
  }
}

export async function deleteResponse(callId: string): Promise<void> {
  getDb().prepare("DELETE FROM response WHERE call_id = ?").run(callId);
}

/** 原版 supabase 返回 `{ email: string }`；SQLite 列可空，这里把 null 归一成空串 */
export async function getAllEmailAddressesForInterview(
  interviewId: string,
): Promise<Array<{ email: string }>> {
  try {
    const rows = getDb()
      .prepare("SELECT email FROM response WHERE interview_id = ?")
      .all(interviewId) as Array<{ email: string | null }>;

    return rows.map((r) => ({ email: r.email ?? "" }));
  } catch (error) {
    console.error("[data/responses] getAllEmailAddressesForInterview failed:", error);

    return [];
  }
}
