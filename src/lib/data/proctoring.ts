import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { getDb, toJsonCol } from "@/lib/db";
import { getAppSettings } from "@/lib/data/settings";
import type {
  ProctorAnalysis,
  ProctorCaptureResult,
  ProctorEventType,
  ProctorSessionSnapshot,
} from "@/lib/proctoring/types";

const MAX_STRIKES = 3;
const CAPTURE_RETENTION_DAYS = 7;
const NORMAL_RESET_MS = 30_000;
const PROCTOR_DIR = path.join(
  process.env.PROCTORING_STORAGE_DIR || path.join(process.cwd(), "data", "proctoring"),
);

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function retentionUntil(): string {
  return new Date(Date.now() + CAPTURE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function assertCall(callId: string): void {
  const row = getDb().prepare("SELECT is_ended FROM response WHERE call_id = ? LIMIT 1").get(callId) as
    | { is_ended: number }
    | undefined;
  if (!row) throw new Error("未找到面试会话。");
  if (row.is_ended === 1) throw new Error("面试已经结束，不能继续采集画面。");
}

export function createProctorSession(callId: string): ProctorSessionSnapshot {
  const settings = getAppSettings();
  if (!settings.proctoringEnabled) {
    return {
      enabled: false,
      token: "",
      intervalSeconds: settings.proctoringIntervalSeconds,
      confidenceThreshold: settings.proctoringConfidenceThreshold,
    };
  }
  assertCall(callId);
  const token = randomBytes(32).toString("base64url");
  getDb()
    .prepare(
      `INSERT INTO proctor_session
       (call_id, token_hash, enabled, interval_seconds, confidence_threshold)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(call_id) DO UPDATE SET token_hash = excluded.token_hash,
       interval_seconds = excluded.interval_seconds, confidence_threshold = excluded.confidence_threshold`,
    )
    .run(callId, hashToken(token), settings.proctoringIntervalSeconds, settings.proctoringConfidenceThreshold);
  return {
    enabled: true,
    token,
    intervalSeconds: settings.proctoringIntervalSeconds,
    confidenceThreshold: settings.proctoringConfidenceThreshold,
  };
}

function getProctorSession(callId: string, token: string) {
  return getDb()
    .prepare(
      `SELECT call_id, token_hash, interval_seconds, confidence_threshold,
       consecutive_failures, last_capture_at
       FROM proctor_session WHERE call_id = ? AND enabled = 1 LIMIT 1`,
    )
    .get(callId) as
    | {
        call_id: string;
        token_hash: string;
        interval_seconds: number;
        confidence_threshold: number;
        consecutive_failures: number;
        last_capture_at: string | null;
      }
    | undefined;
}

function validateImage(dataUrl: string): { mime: string; buffer: Buffer } {
  const match = /^data:(image\/(?:jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("截图格式必须是 JPEG 或 WebP。");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length < 100 || buffer.length > 2_000_000) throw new Error("截图大小不符合要求。");
  if (match[1] === "image/jpeg" && !(buffer[0] === 0xff && buffer[1] === 0xd8)) {
    throw new Error("JPEG 截图签名校验失败。");
  }
  if (
    match[1] === "image/webp" &&
    (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP")
  ) {
    throw new Error("WebP 截图签名校验失败。");
  }
  return { mime: match[1], buffer };
}

function saveImage(callId: string, mime: string, buffer: Buffer): string {
  const extension = mime === "image/webp" ? "webp" : "jpg";
  // call_id 来自浏览器，不能直接作为目录名，避免路径穿越和特殊字符污染文件系统。
  const directory = path.join(PROCTOR_DIR, createHash("sha256").update(callId).digest("hex"));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fileName = `${Date.now()}-${randomBytes(8).toString("hex")}.${extension}`;
  const temporary = path.join(directory, `${fileName}.tmp`);
  const finalPath = path.join(directory, fileName);
  fs.writeFileSync(temporary, buffer, { mode: 0o600 });
  fs.renameSync(temporary, finalPath);
  return finalPath;
}

export function createPendingCapture(input: { callId: string; token: string; dataUrl: string }): {
  captureId: number;
  imageDataUrl: string;
} {
  const session = getProctorSession(input.callId, input.token);
  if (!session || session.token_hash !== hashToken(input.token)) throw new Error("监考会话凭证无效。");
  assertCall(input.callId);
  const { mime, buffer } = validateImage(input.dataUrl);
  const capturedAt = new Date().toISOString();
  const db = getDb();
  const reserve = db.transaction(() => {
    const current = db.prepare("SELECT last_capture_at FROM proctor_session WHERE call_id = ? AND token_hash = ? AND enabled = 1")
      .get(input.callId, hashToken(input.token)) as { last_capture_at: string | null } | undefined;
    if (!current) throw new Error("监考会话已经失效。");
    if (current.last_capture_at && Date.now() - Date.parse(current.last_capture_at) < session.interval_seconds * 1000 - 1000) {
      throw new Error("截图频率超过管理员设置的间隔。");
    }
    db.prepare("UPDATE proctor_session SET last_capture_at = ? WHERE call_id = ?").run(capturedAt, input.callId);
  });
  reserve.immediate();
  const storagePath = saveImage(input.callId, mime, buffer);
  try {
    const result = db
      .prepare(
        `INSERT INTO proctor_capture
         (call_id, captured_at, storage_path, mime_type, byte_size, retention_until)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.callId, capturedAt, storagePath, mime, buffer.length, retentionUntil());
    return { captureId: Number(result.lastInsertRowid), imageDataUrl: input.dataUrl };
  } catch (error) {
    fs.rmSync(storagePath, { force: true });
    throw error;
  }
}

function parseAnalysis(value: ProctorAnalysis): ProctorAnalysis {
  const status = value?.status;
  const allowed = new Set(["clear", "violation", "uncertain"]);
  const types = new Set(["phone", "absent", "multiple_people", "looking_away"]);
  const confidence = Number(value?.confidence);
  const summary = typeof value?.summary === "string" ? value.summary.trim().slice(0, 120) : "";
  const violationType = value?.violationType;
  if (!allowed.has(status) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("视觉模型返回格式无效。");
  }
  if (status === "violation" && (!violationType || !types.has(violationType) || !summary)) {
    throw new Error("视觉模型未返回有效违规类型。");
  }
  return {
    status,
    violationType: status === "violation" ? violationType : null,
    confidence,
    summary,
  };
}

function isNewViolation(db: ReturnType<typeof getDb>, callId: string, type: ProctorEventType, now: string): boolean {
  const state = db
    .prepare("SELECT is_active, normal_since, last_detected_at FROM proctor_violation_state WHERE call_id = ? AND event_type = ?")
    .get(callId, type) as { is_active: number; normal_since: string | null; last_detected_at: string } | undefined;
  if (!state) return true;
  if (state.normal_since && Date.parse(now) - Date.parse(state.normal_since) >= NORMAL_RESET_MS) {
    return true;
  }
  return false;
}

export function recordCaptureAndAnalysis(input: {
  callId: string;
  token: string;
  captureId: number;
  analysis: ProctorAnalysis;
  transcript: Array<{ role: "agent" | "user"; content: string; offset_ms: number }>;
}): ProctorCaptureResult {
  const session = getProctorSession(input.callId, input.token);
  if (!session || session.token_hash !== hashToken(input.token)) throw new Error("监考会话凭证无效。");
  assertCall(input.callId);
  const now = new Date().toISOString();
  const analysis = parseAnalysis(input.analysis);
  const db = getDb();
  const result = db.transaction(() => {
    const capture = db.prepare("SELECT id FROM proctor_capture WHERE id = ? AND call_id = ?").get(input.captureId, input.callId) as { id: number } | undefined;
    if (!capture) throw new Error("截图记录不存在。");
    const captureId = capture.id;
    db.prepare(
      `UPDATE proctor_capture SET analysis_status = 'completed', analysis_result = ?,
       violation_type = ?, confidence = ? WHERE id = ? AND call_id = ?`,
    ).run(toJsonCol(analysis), analysis.violationType, analysis.confidence, captureId, input.callId);
    if (analysis.status === "clear") {
      // 清晰画面开始计算恢复窗口；同一类型连续 30 秒没有再次命中后，下一次才可重新计次。
      db.prepare(
        `UPDATE proctor_violation_state
         SET normal_since = COALESCE(normal_since, ?)
         WHERE call_id = ? AND is_active = 1`,
      ).run(now, input.callId);
    }
    if (analysis.status !== "violation" || !analysis.violationType || analysis.confidence < session.confidence_threshold) {
      return { captureId, strikeCount: 0, event: null, terminated: false };
    }

    if (analysis.violationType === "looking_away") {
      db.prepare("INSERT INTO proctor_gaze_signal (call_id, capture_id, occurred_at) VALUES (?, ?, ?)")
        .run(input.callId, captureId, now);
      const cutoff = new Date(Date.now() - 60_000).toISOString();
      const count = db
        .prepare("SELECT COUNT(*) AS count FROM proctor_gaze_signal WHERE call_id = ? AND occurred_at >= ?")
        .get(input.callId, cutoff) as { count: number };
      if (count.count < 3) return { captureId, strikeCount: 0, event: null, terminated: false };
    }

    if (!isNewViolation(db, input.callId, analysis.violationType, now)) {
      db.prepare(
        `UPDATE proctor_violation_state SET is_active = 1, normal_since = NULL, last_detected_at = ?
         WHERE call_id = ? AND event_type = ?`,
      ).run(now, input.callId, analysis.violationType);
      return { captureId, strikeCount: 0, event: null, terminated: false };
    }

    const strikeRow = db.prepare("SELECT COUNT(*) AS count FROM proctor_event WHERE call_id = ?").get(input.callId) as { count: number };
    const strikeNumber = Number(strikeRow.count) + 1;
    db.prepare(
      `INSERT INTO proctor_event
       (call_id, capture_id, event_type, occurred_at, confidence, summary, strike_number)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(input.callId, captureId, analysis.violationType, now, analysis.confidence, analysis.summary, strikeNumber);
    db.prepare(
      `INSERT INTO proctor_violation_state (call_id, event_type, is_active, last_detected_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(call_id, event_type) DO UPDATE SET is_active = 1, normal_since = NULL, last_detected_at = excluded.last_detected_at`,
    ).run(input.callId, analysis.violationType, now);

    let terminated = false;
    if (strikeNumber >= MAX_STRIKES) {
      const response = db.prepare("SELECT started_at, candidate_id, interview_id, details FROM response WHERE call_id = ? LIMIT 1").get(input.callId) as
        | { started_at: string | null; candidate_id: string | null; interview_id: string; details: string | null }
        | undefined;
      const endedAt = new Date().toISOString();
      const duration = response?.started_at ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(response.started_at)) / 1000)) : 0;
      const proctoring = {
        enabled: true,
        interval_seconds: session.interval_seconds,
        confidence_threshold: session.confidence_threshold,
        strike_count: strikeNumber,
        terminated: true,
      };
      const transcriptObject = input.transcript.map((turn) => ({
        role: turn.role,
        content: turn.content.slice(0, 5000),
        offset_ms: turn.offset_ms,
      }));
      const transcriptText = transcriptObject
        .map((turn) => `${turn.role === "agent" ? "AI 面试官" : "候选人"}：${turn.content}`)
        .join("\n\n");
      let originalDetails: Record<string, unknown> = {};
      try {
        const parsed: unknown = response?.details ? JSON.parse(response.details) : {};
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) originalDetails = parsed as Record<string, unknown>;
      } catch { /* 历史损坏值不妨碍结束面试 */ }
      const events = db.prepare("SELECT event_type, occurred_at, confidence, summary FROM proctor_event WHERE call_id = ? ORDER BY occurred_at").all(input.callId);
      const finalDetails = {
        ...originalDetails,
        call_id: input.callId,
        interview_id: response?.interview_id || "",
        transcript: transcriptText,
        transcript_object: transcriptObject,
        duration,
        server_duration: duration,
        ended_at: endedAt,
        end_reason: "proctoring_terminated",
        interview_questions: originalDetails.interview_questions || [],
        proctoring: { ...proctoring, events },
      };
      const updated = db
        .prepare(
          `UPDATE response SET transcript = ?, details = ?,
           ended_at = ?, server_duration = ?, duration = ?, is_ended = 1, analysis_status = 'idle'
           WHERE call_id = ? AND is_ended = 0`,
        )
        .run(transcriptText, toJsonCol(finalDetails), endedAt, duration, duration, input.callId);
      terminated = updated.changes === 1;
      if (terminated && response?.candidate_id) {
        db.prepare("UPDATE candidate_invite SET status = 'completed', completed_at = ? WHERE id = ?").run(endedAt, response.candidate_id);
      }
    }
    return {
      captureId,
      strikeCount: strikeNumber,
      event: { type: analysis.violationType, confidence: analysis.confidence, summary: analysis.summary },
      terminated,
    };
  })();
  return {
    status: analysis.status,
    maxStrikes: MAX_STRIKES,
    consecutiveFailures: 0,
    ...result,
  };
}

export function recordProctorFailure(callId: string, token: string, captureId: number, code: string, message: string): number {
  const session = getProctorSession(callId, token);
  if (!session || session.token_hash !== hashToken(token)) throw new Error("监考会话凭证无效。");
  const failures = session.consecutive_failures + 1;
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE proctor_session SET consecutive_failures = ? WHERE call_id = ?").run(failures, callId);
    db.prepare(
      `UPDATE proctor_capture SET analysis_status = 'failed', error_code = ?, analysis_result = ? WHERE id = ? AND call_id = ?`,
    ).run(code, JSON.stringify({ code, message: message.slice(0, 200) }), captureId, callId);
    db.prepare(
      `INSERT INTO proctor_service_event (call_id, consecutive_failures, error_code, message)
       VALUES (?, ?, ?, ?)`,
    ).run(callId, failures, code, message.slice(0, 200));
  })();
  return failures;
}

export function markProctorSuccess(callId: string, token: string): void {
  const session = getProctorSession(callId, token);
  if (!session || session.token_hash !== hashToken(token)) return;
  getDb().prepare("UPDATE proctor_session SET consecutive_failures = 0 WHERE call_id = ?").run(callId);
}

export function getCapturePath(captureId: number): { path: string; mime: string } | null {
  const row = getDb().prepare("SELECT storage_path, mime_type FROM proctor_capture WHERE id = ? AND retention_until > ? LIMIT 1").get(captureId, new Date().toISOString()) as { storage_path: string; mime_type: string } | undefined;
  if (!row || !fs.existsSync(row.storage_path)) return null;
  return { path: row.storage_path, mime: row.mime_type };
}

export function listProctorCaptures(callId: string) {
  return getDb().prepare(
    `SELECT id, call_id, captured_at, mime_type, byte_size, analysis_status,
     analysis_result, violation_type, confidence, error_code, retention_until
     FROM proctor_capture WHERE call_id = ? ORDER BY captured_at DESC`,
  ).all(callId);
}

export function getProctorEvidence(callId: string) {
  const db = getDb();
  return {
    captures: listProctorCaptures(callId),
    events: db.prepare(
      `SELECT id, event_type, capture_id, occurred_at, confidence, summary, strike_number
       FROM proctor_event WHERE call_id = ? ORDER BY occurred_at ASC`,
    ).all(callId),
    serviceEvents: db.prepare(
      `SELECT id, occurred_at, consecutive_failures, error_code, message
       FROM proctor_service_event WHERE call_id = ? ORDER BY occurred_at DESC`,
    ).all(callId),
  };
}

export function getProctorSessionInfo(callId: string) {
  return getDb().prepare(
    `SELECT enabled, interval_seconds, confidence_threshold, consecutive_failures
     FROM proctor_session WHERE call_id = ? LIMIT 1`,
  ).get(callId) as {
    enabled: number;
    interval_seconds: number;
    confidence_threshold: number;
    consecutive_failures: number;
  } | undefined;
}

/** 删除某些面试会话关联的所有监考图片和元数据，供候选人数据删除/后台删除复用。 */
export function removeProctorDataForCalls(callIds: string[]): void {
  const ids = Array.from(new Set(callIds.filter(Boolean)));
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT storage_path FROM proctor_capture WHERE call_id IN (${placeholders})`)
    .all(...ids) as Array<{ storage_path: string }>;
  for (const row of rows) {
    try {
      fs.rmSync(row.storage_path, { force: true });
    } catch {
      // 文件不存在或暂时无法删除时，数据库记录仍会被清理，避免继续暴露元数据。
    }
  }
  const remove = db.transaction(() => {
    db.prepare(`DELETE FROM proctor_event WHERE call_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM proctor_gaze_signal WHERE call_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM proctor_capture WHERE call_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM proctor_service_event WHERE call_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM proctor_violation_state WHERE call_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM proctor_session WHERE call_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM candidate_action_token WHERE call_id IN (${placeholders})`).run(...ids);
  });
  remove.immediate();
}

export function cleanupExpiredProctorCaptures(): number {
  const db = getDb();
  const rows = db.prepare("SELECT id, storage_path FROM proctor_capture WHERE retention_until <= ?").all(new Date().toISOString()) as Array<{ id: number; storage_path: string }>;
  const cleanup = db.transaction(() => {
    for (const row of rows) {
      try { fs.rmSync(row.storage_path, { force: true }); } catch { /* 清理失败由下一轮继续尝试 */ }
      db.prepare("DELETE FROM proctor_capture WHERE id = ?").run(row.id);
    }
    db.prepare("DELETE FROM proctor_service_event WHERE occurred_at <= datetime('now', '-7 days')").run();
    db.prepare("DELETE FROM proctor_gaze_signal WHERE occurred_at <= datetime('now', '-7 days')").run();
  });
  cleanup.immediate();
  return rows.length;
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/** 长驻服务每小时执行一次到期截图清理；API 访问时也会额外清理。 */
export function startProctorCleanupScheduler(): void {
  if (cleanupTimer) return;
  cleanupExpiredProctorCaptures();
  cleanupTimer = setInterval(() => cleanupExpiredProctorCaptures(), 60 * 60 * 1000);
  cleanupTimer.unref?.();
}
