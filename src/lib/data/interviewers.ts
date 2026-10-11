import { getDb } from "@/lib/db";
import type { Interviewer } from "@/types/interviewer";

/**
 * interviewer 表的服务端仓储（SQLite）。
 * 只能在服务端组件 / Server Action / Route Handler 中 import。
 *
 * 对外返回**领域类型** `Interviewer`（SQLite 里可为 NULL 的列在此归一成空串），
 * 这样服务端页面拿到的行可以直接传给组件，不需要在调用点再做 Cast。
 */

export type InterviewerRow = Interviewer;

/** SQLite 列可为 NULL，统一归一成空串（原版 supabase 里这些列是 NOT NULL） */
function fromRow(row: unknown): Interviewer | null {
  if (!row || typeof row !== "object") {
    return null;
  }
  const r = row as Record<string, any>;

  return {
    ...r,
    id: Number(r.id),
    name: r.name ?? "",
    description: r.description ?? "",
    image: r.image ?? "",
    audio: r.audio ?? "",
    agent_id: r.agent_id ?? "",
    empathy: Number(r.empathy ?? 0),
    exploration: Number(r.exploration ?? 0),
    rapport: Number(r.rapport ?? 0),
    speed: Number(r.speed ?? 0),
  } as Interviewer;
}

const INSERT_COLS = [
  "name",
  "description",
  "image",
  "audio",
  "empathy",
  "exploration",
  "rapport",
  "speed",
] as const;

export async function getAllInterviewers(): Promise<InterviewerRow[]> {
  try {
    return getDb()
      .prepare("SELECT * FROM interviewer ORDER BY id ASC")
      .all()
      .map(fromRow)
      .filter(Boolean) as InterviewerRow[];
  } catch (error) {
    console.error("[data/interviewers] getAllInterviewers failed:", error);

    return [];
  }
}

export async function getInterviewer(interviewerId: number | bigint): Promise<InterviewerRow | null> {
  try {
    const id = Number(interviewerId);
    if (!Number.isFinite(id)) {
      return null;
    }
    const row = getDb().prepare("SELECT * FROM interviewer WHERE id = ?").get(id);

    return fromRow(row);
  } catch (error) {
    console.error("[data/interviewers] getInterviewer failed:", error);

    return null;
  }
}

export async function createInterviewer(
  payload: Record<string, unknown>,
): Promise<InterviewerRow | null> {
  const row: Record<string, unknown> = {};
  for (const col of INSERT_COLS) {
    if (payload[col] !== undefined) {
      row[col] = payload[col];
    }
  }
  if (!row.name) {
    throw new Error("createInterviewer: name is required");
  }

  const cols = Object.keys(row);
  const sql = `INSERT INTO interviewer (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  const values = cols.map((c) => row[c]) as (string | number | null)[];

  const result = getDb().prepare(sql).run(...values);

  return getInterviewer(Number(result.lastInsertRowid));
}

/**
 * 建两个默认面试官。种子数据来自 `lib/constants.ts` 的 INTERVIEWERS
 * （该文件由 P1 负责改成中文人设 —— 改完这里自动跟着变，不用再动）。
 */
export async function ensureDefaultInterviewers(
  seeds: Array<{
    name: string;
    description: string;
    image: string;
    audio: string;
    empathy: number;
    exploration: number;
    rapport: number;
    speed: number;
  }>,
): Promise<InterviewerRow[]> {
  const existing = await getAllInterviewers();
  if (existing.length > 0) {
    return existing;
  }

  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO interviewer (name, description, image, audio, empathy, exploration, rapport, speed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const seed of seeds) {
    stmt.run(
      seed.name,
      seed.description,
      seed.image,
      seed.audio,
      seed.empathy,
      seed.exploration,
      seed.rapport,
      seed.speed,
    );
  }

  return getAllInterviewers();
}
