import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

/**
 * SQLite 连接单例 + 建表。
 *
 * 仅服务端可用：本文件被 `src/lib/data/**` 引用，而 `src/lib/data/**`
 * 只会被服务端组件 / Server Action / Route Handler import。
 * 客户端组件请走 `src/app/actions/**`(Server Actions) 或 `src/services/**`。
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS interviewer (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    agent_id    TEXT    NOT NULL DEFAULT '',
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    image       TEXT    NOT NULL DEFAULT '',
    audio       TEXT,
    empathy     INTEGER NOT NULL DEFAULT 5,
    exploration INTEGER NOT NULL DEFAULT 5,
    rapport     INTEGER NOT NULL DEFAULT 5,
    speed       INTEGER NOT NULL DEFAULT 5
);

CREATE TABLE IF NOT EXISTS interview (
    id              TEXT    PRIMARY KEY,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    name            TEXT,
    description     TEXT,
    objective       TEXT,
    interviewer_id  INTEGER,
    is_active       INTEGER NOT NULL DEFAULT 1,
    is_anonymous    INTEGER NOT NULL DEFAULT 0,
    is_archived     INTEGER NOT NULL DEFAULT 0,
    logo_url        TEXT,
    theme_color     TEXT,
    url             TEXT,
    readable_slug   TEXT,
    questions       TEXT,
    quotes          TEXT,
    insights        TEXT,
    respondents     TEXT,
    question_count  INTEGER,
    response_count  INTEGER,
    time_duration   TEXT
);

CREATE TABLE IF NOT EXISTS response (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    interview_id      TEXT,
    name              TEXT,
    email             TEXT,
    call_id           TEXT,
    candidate_status  TEXT,
    duration          INTEGER,
    transcript        TEXT,
    details           TEXT,
    analytics         TEXT,
    is_analysed       INTEGER NOT NULL DEFAULT 0,
    is_ended          INTEGER NOT NULL DEFAULT 0,
    is_viewed         INTEGER NOT NULL DEFAULT 0,
    tab_switch_count  INTEGER
);

CREATE TABLE IF NOT EXISTS feedback (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    interview_id TEXT,
    email        TEXT,
    feedback     TEXT,
    satisfaction INTEGER
);

CREATE TABLE IF NOT EXISTS app_setting (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL DEFAULT '',
    is_secret   INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_interview_slug    ON interview(readable_slug);
CREATE INDEX IF NOT EXISTS idx_response_call_id  ON response(call_id);
CREATE INDEX IF NOT EXISTS idx_response_interview ON response(interview_id);
CREATE INDEX IF NOT EXISTS idx_feedback_interview ON feedback(interview_id);
`;

// dev 模式下 Next 会热重载模块，用 globalThis 缓存避免重复打开 / 重复建表
const globalForDb = globalThis as unknown as { __foloupDb?: Database.Database };

function resolveDbPath(): string {
  return process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "foloup.db");
}

function open(): Database.Database {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(SCHEMA);

  return database;
}

export function getDb(): Database.Database {
  if (!globalForDb.__foloupDb) {
    globalForDb.__foloupDb = open();
  }

  return globalForDb.__foloupDb;
}

/* ------------------------------------------------------------------ */
/* 行列转换辅助：JSON 列 <-> 对象，0/1 <-> boolean                      */
/* ------------------------------------------------------------------ */

export function toJsonCol(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.stringify(value);
}

export function fromJsonCol<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value !== "string") {
    return value as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toBoolCol(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  return value ? 1 : 0;
}

export function fromBoolCol(value: unknown): boolean {
  return value === 1 || value === true;
}
