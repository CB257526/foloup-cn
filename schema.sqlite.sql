-- ============================================================================
-- SQLite 建表语句（P0 地基）
--
-- 原 supabase_schema.sql 是 Postgres + 多租户版，已废弃。
-- 本文件是**参考用**的权威建表语句；运行时实际由 `src/lib/db.ts` 的 SCHEMA 常量
-- 自动 CREATE TABLE IF NOT EXISTS，不需要手工执行本文件。
--
-- 相对原版的删减（单租户改造）：
--   - 删除 organization 表、user 表、"plan" 枚举
--   - 删除 interview.organization_id / interview.user_id / interviewer.user_id
--   - interviewer.id 用 INTEGER PRIMARY KEY AUTOINCREMENT（SQLite 无 SERIAL）
--   - JSONB / TEXT[] 统一改为 TEXT（JSON 文本），读写由 src/lib/db.ts 的
--     toJsonCol / fromJsonCol 负责序列化
--   - BOOLEAN 改为 INTEGER（0/1），由 toBoolCol / fromBoolCol 转换
--   - timestamps 改为 TEXT，默认 datetime('now')（UTC）
--
-- 相对原版的**新增**：
--   - response.transcript —— 逐字稿纯文本（P1 语音层写入，见接口冻结第 4 节）
-- ============================================================================

CREATE TABLE IF NOT EXISTS interviewer (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    agent_id    TEXT    NOT NULL DEFAULT '',   -- Retell 残留，P1 删掉 register-call 后可删
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
    interviewer_id  INTEGER,                  -- 0 表示"未选面试官"
    is_active       INTEGER NOT NULL DEFAULT 1,
    is_anonymous    INTEGER NOT NULL DEFAULT 0,
    is_archived     INTEGER NOT NULL DEFAULT 0,
    logo_url        TEXT,
    theme_color     TEXT,
    url             TEXT,
    readable_slug   TEXT,
    questions       TEXT,                     -- JSON 数组
    quotes          TEXT,                     -- JSON 数组
    insights        TEXT,                     -- JSON 数组
    respondents     TEXT,                     -- JSON 数组
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
    transcript        TEXT,                   -- 逐字稿纯文本（P1 写入）
    details           TEXT,                   -- JSON 透传，数据层不解释结构
    analytics         TEXT,                   -- JSON 透传，数据层不解释结构
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

CREATE INDEX IF NOT EXISTS idx_interview_slug     ON interview(readable_slug);
CREATE INDEX IF NOT EXISTS idx_response_call_id   ON response(call_id);
CREATE INDEX IF NOT EXISTS idx_response_interview ON response(interview_id);
CREATE INDEX IF NOT EXISTS idx_feedback_interview ON feedback(interview_id);
