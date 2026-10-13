import fs from "fs";
import path from "node:path";
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
    time_duration   TEXT,
    competency_dimensions TEXT
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
    candidate_id      TEXT,
    started_at        TEXT,
    ended_at          TEXT,
    server_duration   INTEGER,
    expires_at        TEXT,
    transcript        TEXT,
    details           TEXT,
    analytics         TEXT,
    is_analysed       INTEGER NOT NULL DEFAULT 0,
    analysis_status   TEXT NOT NULL DEFAULT 'idle',
    analysis_started_at TEXT,
    is_ended          INTEGER NOT NULL DEFAULT 0,
    is_viewed         INTEGER NOT NULL DEFAULT 0,
    tab_switch_count  INTEGER
);

CREATE TABLE IF NOT EXISTS candidate_invite (
    id                TEXT PRIMARY KEY,
    interview_id      TEXT NOT NULL,
    name              TEXT NOT NULL,
    email             TEXT NOT NULL,
    resume_file_name  TEXT NOT NULL,
    resume_text       TEXT NOT NULL,
    candidate_description TEXT NOT NULL,
    questions         TEXT NOT NULL,
    invite_token      TEXT NOT NULL UNIQUE,
    status            TEXT NOT NULL DEFAULT 'ready',
    consent_version   TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    started_at        TEXT,
    completed_at      TEXT,
    revoked_at        TEXT
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

CREATE TABLE IF NOT EXISTS consent_record (
    id                         INTEGER PRIMARY KEY AUTOINCREMENT,
    interview_id               TEXT NOT NULL,
    candidate_id               TEXT,
    call_id                    TEXT,
    candidate_email            TEXT,
    candidate_name             TEXT,
    consent_version            TEXT NOT NULL,
    voice_processing_accepted  INTEGER NOT NULL DEFAULT 0,
    evaluation_accepted        INTEGER NOT NULL DEFAULT 0,
    camera_monitoring_accepted INTEGER NOT NULL DEFAULT 0,
    improvement_accepted       INTEGER NOT NULL DEFAULT 0,
    created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
    withdrawn_at               TEXT,
    user_agent                 TEXT,
    ip_hash                    TEXT
);

CREATE TABLE IF NOT EXISTS admin_account (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    username              TEXT NOT NULL UNIQUE,
    password_hash         TEXT NOT NULL,
    password_salt         TEXT NOT NULL,
    must_change_password  INTEGER NOT NULL DEFAULT 1,
    is_active             INTEGER NOT NULL DEFAULT 1,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at         TEXT
);

CREATE TABLE IF NOT EXISTS auth_session (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id       INTEGER NOT NULL,
    token_hash     TEXT NOT NULL UNIQUE,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at     TEXT NOT NULL,
    revoked_at     TEXT,
    FOREIGN KEY (admin_id) REFERENCES admin_account(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS candidate_action_token (
    call_id       TEXT PRIMARY KEY,
    token_hash    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS proctor_session (
    call_id                   TEXT PRIMARY KEY,
    token_hash                TEXT NOT NULL,
    enabled                   INTEGER NOT NULL DEFAULT 1,
    interval_seconds          INTEGER NOT NULL DEFAULT 30,
    confidence_threshold      REAL NOT NULL DEFAULT 0.85,
    consecutive_failures      INTEGER NOT NULL DEFAULT 0,
    last_capture_at           TEXT,
    created_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS proctor_capture (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id           TEXT NOT NULL,
    captured_at       TEXT NOT NULL DEFAULT (datetime('now')),
    storage_path      TEXT NOT NULL,
    mime_type         TEXT NOT NULL,
    byte_size         INTEGER NOT NULL,
    analysis_status   TEXT NOT NULL DEFAULT 'pending',
    analysis_result   TEXT,
    violation_type    TEXT,
    confidence        REAL,
    error_code        TEXT,
    retention_until   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proctor_event (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id        TEXT NOT NULL,
    capture_id     INTEGER NOT NULL,
    event_type     TEXT NOT NULL,
    occurred_at    TEXT NOT NULL DEFAULT (datetime('now')),
    confidence     REAL NOT NULL,
    summary        TEXT NOT NULL,
    strike_number  INTEGER NOT NULL,
    FOREIGN KEY (capture_id) REFERENCES proctor_capture(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS proctor_violation_state (
    call_id         TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,
    normal_since    TEXT,
    last_detected_at TEXT NOT NULL,
    PRIMARY KEY (call_id, event_type)
);

CREATE TABLE IF NOT EXISTS proctor_gaze_signal (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id      TEXT NOT NULL,
    capture_id   INTEGER NOT NULL,
    occurred_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (capture_id) REFERENCES proctor_capture(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS proctor_service_event (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id               TEXT NOT NULL,
    occurred_at           TEXT NOT NULL DEFAULT (datetime('now')),
    consecutive_failures  INTEGER NOT NULL,
    error_code             TEXT NOT NULL,
    message                TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interview_slug    ON interview(readable_slug);
CREATE INDEX IF NOT EXISTS idx_response_call_id  ON response(call_id);
CREATE INDEX IF NOT EXISTS idx_response_interview ON response(interview_id);
CREATE INDEX IF NOT EXISTS idx_candidate_invite_interview ON candidate_invite(interview_id);
CREATE INDEX IF NOT EXISTS idx_feedback_interview ON feedback(interview_id);
CREATE INDEX IF NOT EXISTS idx_consent_interview ON consent_record(interview_id);
CREATE INDEX IF NOT EXISTS idx_consent_call_id ON consent_record(call_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_token ON auth_session(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_session_admin ON auth_session(admin_id);
CREATE INDEX IF NOT EXISTS idx_proctor_capture_call ON proctor_capture(call_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_proctor_event_call ON proctor_event(call_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_proctor_service_call ON proctor_service_event(call_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_proctor_gaze_call_time ON proctor_gaze_signal(call_id, occurred_at);
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
  migrate(database);

  return database;
}

/**
 * 为已经存在的 SQLite 文件补齐新字段。
 *
 * `CREATE TABLE IF NOT EXISTS` 不会修改旧表结构，而开发环境中的数据库文件
 * 通常会跨多个改造阶段复用，因此这里使用固定字段白名单做轻量迁移。
 * 不执行删除或重命名，避免破坏历史面试数据。
 */
function migrate(database: Database.Database): void {
  const columnsByTable: Record<string, Record<string, string>> = {
    interview: {
      competency_dimensions: "TEXT",
    },
    response: {
      candidate_id: "TEXT",
      started_at: "TEXT",
      ended_at: "TEXT",
      server_duration: "INTEGER",
      expires_at: "TEXT",
      analysis_status: "TEXT NOT NULL DEFAULT 'idle'",
      analysis_started_at: "TEXT",
    },
    consent_record: {
      candidate_id: "TEXT",
      camera_monitoring_accepted: "INTEGER NOT NULL DEFAULT 0",
    },
  };

  for (const [table, columns] of Object.entries(columnsByTable)) {
    const existing = new Set(
      (database.pragma(`table_info(${table})`) as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    );

    for (const [column, definition] of Object.entries(columns)) {
      if (!existing.has(column)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
  }

  // 仅在历史库没有重复 call_id 时添加物理唯一索引，避免升级失败或删除历史数据。
  // 会话动作也会使用 SQLite 立即事务，在旧重复数据存在时继续保证新写幂等。
  const duplicate = database
    .prepare(
      `SELECT 1 FROM response WHERE call_id IS NOT NULL
       GROUP BY call_id HAVING COUNT(*) > 1 LIMIT 1`,
    )
    .get();
  if (!duplicate) {
    database.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_response_call_id_unique ON response(call_id) WHERE call_id IS NOT NULL",
    );
  }
  database.exec("CREATE INDEX IF NOT EXISTS idx_response_candidate_id ON response(candidate_id)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_auth_session_token ON auth_session(token_hash)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_auth_session_admin ON auth_session(admin_id)");
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_proctor_capture_call ON proctor_capture(call_id, captured_at)",
  );
  database.exec("CREATE INDEX IF NOT EXISTS idx_proctor_event_call ON proctor_event(call_id, occurred_at)");
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_proctor_service_call ON proctor_service_event(call_id, occurred_at)",
  );
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_proctor_gaze_call_time ON proctor_gaze_signal(call_id, occurred_at)",
  );
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
