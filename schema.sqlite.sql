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
    time_duration   TEXT,
    competency_dimensions TEXT             -- JSON 数组，预留给岗位能力维度
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
    candidate_id      TEXT,              -- 可空；P0/P1 历史记录不关联专属候选人邀请
    started_at        TEXT,                  -- 服务端确认接通后的真实开始时间
    ended_at          TEXT,                  -- 服务端完成动作生成的真实结束时间
    server_duration   INTEGER,              -- started_at 与 ended_at 的服务端计算秒数
    expires_at        TEXT,                  -- 服务端根据岗位时长计算的到期时间
    transcript        TEXT,                   -- 逐字稿纯文本（P1 写入）
    details           TEXT,                   -- JSON 透传，数据层不解释结构
    analytics         TEXT,                   -- JSON 透传，数据层不解释结构
    is_analysed       INTEGER NOT NULL DEFAULT 0,
    analysis_status   TEXT NOT NULL DEFAULT 'idle', -- idle/processing/completed/failed
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
    resume_text       TEXT NOT NULL,          -- 加密后的简历正文
    candidate_description TEXT NOT NULL,
    questions         TEXT NOT NULL,          -- 该候选人专属的 JSON 题目快照
    invite_token      TEXT NOT NULL UNIQUE,   -- 不可猜测的个人面试链接令牌
    status            TEXT NOT NULL DEFAULT 'ready', -- ready / in_progress / completed / revoked
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
    call_id          TEXT NOT NULL,
    event_type       TEXT NOT NULL,
    is_active        INTEGER NOT NULL DEFAULT 1,
    normal_since     TEXT,
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

CREATE INDEX IF NOT EXISTS idx_interview_slug     ON interview(readable_slug);
CREATE INDEX IF NOT EXISTS idx_response_call_id   ON response(call_id);
CREATE INDEX IF NOT EXISTS idx_response_interview ON response(interview_id);
CREATE INDEX IF NOT EXISTS idx_response_candidate_id ON response(candidate_id);
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
