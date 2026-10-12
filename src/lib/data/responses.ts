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
  candidate_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  server_duration: number | null;
  expires_at: string | null;
  transcript: string | null;
  details: unknown;
  analytics: unknown;
  is_analysed: boolean;
  analysis_status: string;
  analysis_started_at: string | null;
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
  "started_at",
  "ended_at",
  "server_duration",
  "expires_at",
  "transcript",
  "tab_switch_count",
] as const;

/** 通用客户端更新只允许维护候选状态和已读状态，其余字段由专用动作管理。 */
const CLIENT_UPDATE_COLS = new Set(["candidate_status", "is_viewed"]);

/** 普通创建动作只允许建立未开始占位记录，正式开始必须走 startCallSession。 */
const CLIENT_CREATE_COLS = new Set(["interview_id", "name", "email", "call_id"]);

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
    analysis_status: r.analysis_status ?? "idle",
    analysis_started_at: r.analysis_started_at ?? null,
    is_ended: fromBoolCol(r.is_ended),
    is_viewed: fromBoolCol(r.is_viewed),
  } as unknown as ResponseRow;
}

/** 返回新插入行的 id（供 P1 建通话时回读） */
export async function createResponse(payload: Record<string, unknown>): Promise<number | null> {
  const row = Object.fromEntries(
    Object.entries(toRow(payload)).filter(([column]) => CLIENT_CREATE_COLS.has(column)),
  );
  const cols = Object.keys(row);

  if (cols.length === 0) {
    return null;
  }

  const values = cols.map((c) => row[c]) as SqliteBinding[];
  const db = getDb();
  // immediate transaction 在查重之前取得写锁，保证旧库没有唯一索引时也可并发幂等。
  const insert = db.transaction(() => {
    if (typeof row.call_id === "string") {
      const existing = db
        .prepare("SELECT id FROM response WHERE call_id = ? ORDER BY id LIMIT 1")
        .get(row.call_id) as { id?: number } | undefined;
      if (existing?.id !== undefined) {
        return Number(existing.id);
      }
    }

    const sql = `INSERT INTO response (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    const result = db.prepare(sql).run(...values);
    return Number(result.lastInsertRowid);
  });

  return insert.immediate();
}

export async function saveResponse(
  payload: Record<string, unknown>,
  callId: string,
): Promise<void> {
  const row = Object.fromEntries(
    Object.entries(toRow(payload)).filter(([column]) => CLIENT_UPDATE_COLS.has(column)),
  );
  const cols = Object.keys(row);

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

/**
 * 领取一次评分任务，防止两个 get-call 请求同时对同一个 call_id 调用模型。
 *
 * 评分状态不单独暴露给业务页面：成功仍以 is_analysed=1 为准，失败时由释放函数
 * 恢复为可重试状态。这个原子 UPDATE 依赖 SQLite 的写锁，即使请求并发到达也只有
 * 一个请求能拿到 changes=1；处于 processing 的会话不自动二次领取，优先保证不重复计费。
 */
export async function claimAnalysis(callId: string): Promise<boolean> {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE response
       SET analysis_status = 'processing', analysis_started_at = ?
       WHERE call_id = ? AND is_ended = 1 AND is_analysed = 0
         AND analysis_status IN ('idle', 'failed')`,
    )
    .run(now, callId);

  if (result.changes !== 1) {
    return false;
  }

  return true;
}

/** 评分成功后写入最终 analytics，并清除内部领取标记。 */
export async function completeAnalysis(callId: string, analytics: unknown): Promise<void> {
  getDb()
    .prepare(
      `UPDATE response
       SET analytics = ?, is_analysed = 1, analysis_status = 'completed',
           analysis_started_at = NULL, duration = COALESCE(server_duration, duration)
       WHERE call_id = ?`,
    )
    .run(toJsonCol(analytics), callId);
}

/** 模型调用失败时恢复 is_analysed，让 HR 后续仍可重新触发评分。 */
export async function releaseAnalysis(callId: string): Promise<void> {
  getDb()
    .prepare(
      `UPDATE response
       SET analysis_status = 'failed', analysis_started_at = NULL, is_analysed = 0
       WHERE call_id = ? AND analysis_status = 'processing'`,
    )
    .run(callId);
}

/** 原版 supabase 返回 `{ email: string }`；SQLite 列可空，这里把 null 归一成空串 */
export async function getAllEmailAddressesForInterview(
  interviewId: string,
): Promise<Array<{ email: string }>> {
  try {
    const rows = getDb()
      // 未结束的连接中断 / 重试记录不能占用候选人邮箱；只有正式完成记录才用于防重复参加。
      .prepare("SELECT email FROM response WHERE interview_id = ? AND is_ended = 1")
      .all(interviewId) as Array<{ email: string | null }>;

    return rows.map((r) => ({ email: r.email ?? "" }));
  } catch (error) {
    console.error("[data/responses] getAllEmailAddressesForInterview failed:", error);

    return [];
  }
}
