import { normalizeInterviewDuration } from "@/lib/constants";
import { fromBoolCol, fromJsonCol, getDb, toBoolCol, toJsonCol } from "@/lib/db";
import type { Interview } from "@/types/interview";
import { normalizeCompetencyDimensions } from "@/types/interview";
import type { CompetencyDimension } from "@/types/response";

/**
 * interview 表的服务端仓储（SQLite）。
 * 只能在服务端组件 / Server Action / Route Handler 中 import。
 */

type SqliteBinding = string | number | bigint | Buffer | null;

/**
 * JSON 列白名单。
 *
 * `competency_dimensions` 是 P0 预留、本任务（后续 P1）真正开始写入的岗位能力维度：
 * 放进白名单后，创建/编辑岗位都会自动做 JSON 序列化，读取时在 fromRow 里解析回数组。
 */
const JSON_COLS = [
  "questions",
  "quotes",
  "insights",
  "respondents",
  "competency_dimensions",
] as const;
const BOOL_COLS = ["is_active", "is_anonymous", "is_archived"] as const;
const PLAIN_COLS = [
  "id",
  "name",
  "description",
  "objective",
  "interviewer_id",
  "logo_url",
  "theme_color",
  "url",
  "readable_slug",
  "question_count",
  "response_count",
  "time_duration",
] as const;

/** 原版把 0 当作"未选面试官"。统一归一成 number（原版是 bigint，SQLite 无 int8） */
function normalizeInterviewerId(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const n = Number(value);

  return Number.isFinite(n) ? n : 0;
}

function toRow(payload: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  for (const col of PLAIN_COLS) {
    if (payload[col] === undefined) {
      continue;
    }
    if (col === "interviewer_id") {
      row[col] = normalizeInterviewerId(payload[col]);
    } else if (col === "time_duration") {
      // 所有写入统一经过归一化，避免空值再次让候选人页面回退到错误的 1 分钟。
      row[col] = normalizeInterviewDuration(payload[col]);
    } else {
      row[col] = payload[col];
    }
  }

  for (const col of JSON_COLS) {
    if (payload[col] === undefined) {
      continue;
    }
    row[col] = toJsonCol(payload[col]);
  }

  for (const col of BOOL_COLS) {
    if (payload[col] === undefined) {
      continue;
    }
    row[col] = toBoolCol(payload[col]);
  }

  return row;
}

function fromRow(row: unknown): Interview | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const r = row as Record<string, any>;

  return {
    ...r,
    questions: fromJsonCol<unknown[]>(r.questions, []),
    quotes: fromJsonCol<unknown[]>(r.quotes, []),
    insights: fromJsonCol<unknown[]>(r.insights, []),
    respondents: fromJsonCol<unknown[]>(r.respondents, []),
    // 维度在数据库里是 JSON 字符串，这里统一解析成数组，避免把裸字符串传给 HR 界面。
    competency_dimensions: normalizeCompetencyDimensions(
      fromJsonCol<CompetencyDimension[]>(r.competency_dimensions, []),
    ),
    is_active: fromBoolCol(r.is_active),
    is_anonymous: fromBoolCol(r.is_anonymous),
    is_archived: fromBoolCol(r.is_archived),
    interviewer_id: normalizeInterviewerId(r.interviewer_id),
    question_count:
      r.question_count === null || r.question_count === undefined ? 0 : Number(r.question_count),
    response_count:
      r.response_count === null || r.response_count === undefined ? 0 : Number(r.response_count),
    time_duration: normalizeInterviewDuration(r.time_duration),
  } as unknown as Interview;
}

export async function getAllInterviews(): Promise<Interview[]> {
  try {
    const rows = getDb()
      .prepare("SELECT * FROM interview ORDER BY created_at DESC, rowid DESC")
      .all();

    return rows.map(fromRow).filter(Boolean) as Interview[];
  } catch (error) {
    console.error("[data/interviews] getAllInterviews failed:", error);

    return [];
  }
}

export async function getInterviewById(id: string): Promise<Interview | null> {
  try {
    const row = getDb()
      .prepare("SELECT * FROM interview WHERE id = ? OR readable_slug = ? LIMIT 1")
      .get(id, id);

    return fromRow(row);
  } catch (error) {
    console.error("[data/interviews] getInterviewById failed:", error);

    return null;
  }
}

export async function getAllRespondents(interviewId: string): Promise<unknown[]> {
  try {
    const row = getDb()
      .prepare("SELECT respondents FROM interview WHERE id = ?")
      .get(interviewId) as { respondents: string | null } | undefined;

    return fromJsonCol<unknown[]>(row?.respondents, []);
  } catch (error) {
    console.error("[data/interviews] getAllRespondents failed:", error);

    return [];
  }
}

export async function createInterview(payload: Record<string, unknown>): Promise<Interview | null> {
  const row = toRow(payload);
  if (!row.id) {
    throw new Error("createInterview: payload.id is required");
  }

  const cols = Object.keys(row);
  const sql = `INSERT INTO interview (${cols.join(", ")}) VALUES (${cols.map((c) => "?").join(", ")})`;

  const values = cols.map((c) => row[c]) as SqliteBinding[];
  getDb()
    .prepare(sql)
    .run(...values);

  return getInterviewById(String(row.id));
}

export async function updateInterview(
  payload: Record<string, unknown>,
  id: string,
): Promise<Interview | null> {
  const row = toRow(payload);
  const cols = Object.keys(row).filter((c) => c !== "id");

  if (cols.length === 0) {
    return getInterviewById(id);
  }

  const sql = `UPDATE interview SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`;

  const values = cols.map((c) => row[c]) as SqliteBinding[];
  getDb()
    .prepare(sql)
    .run(...values, id);

  return getInterviewById(id);
}

export async function deleteInterview(id: string): Promise<void> {
  const db = getDb();
  const remove = db.transaction(() => {
    db.prepare("DELETE FROM consent_record WHERE interview_id = ?").run(id);
    db.prepare("DELETE FROM response WHERE interview_id = ?").run(id);
    db.prepare("DELETE FROM candidate_invite WHERE interview_id = ?").run(id);
    db.prepare("DELETE FROM feedback WHERE interview_id = ?").run(id);
    db.prepare("DELETE FROM interview WHERE id = ?").run(id);
  });
  remove.immediate();
}
