import { normalizeInterviewDuration } from "@/lib/constants";
import { markCandidateInviteCompleted, markCandidateInviteStarted } from "@/lib/data/candidates";
import { assertCandidateConsentForCall } from "@/lib/data/consents";
import type { ResponseRow } from "@/lib/data/responses";
import { getDb, toJsonCol } from "@/lib/db";
import type {
  CallData,
  CallEndReason,
  CallSessionFinishResult,
  CallSessionStartResult,
  CompetencyDimensions,
} from "@/types/response";

type SqliteBinding = string | number | bigint | Buffer | null;

export type CreateConsentRecordInput = {
  interviewId: string;
  candidateId?: string | null;
  callId?: string | null;
  candidateEmail?: string | null;
  candidateName?: string | null;
  consentVersion: string;
  voiceProcessingAccepted: boolean;
  evaluationAccepted: boolean;
  improvementAccepted: boolean;
  userAgent?: string | null;
  ipHash?: string | null;
};

/** 保存岗位能力维度的纯数据接口，后续界面可复用，不在本阶段实现页面业务。 */
export async function saveCompetencyDimensions(
  interviewId: string,
  dimensions: CompetencyDimensions,
): Promise<boolean> {
  if (!interviewId || !Array.isArray(dimensions)) {
    throw new Error("岗位能力维度参数格式错误");
  }
  for (const item of dimensions) {
    if (!item || typeof item.key !== "string" || typeof item.name !== "string") {
      throw new Error("每项岗位能力维度都必须包含 key 和 name");
    }
  }

  const result = getDb()
    .prepare("UPDATE interview SET competency_dimensions = ? WHERE id = ?")
    .run(toJsonCol(dimensions), interviewId);

  return result.changes === 1;
}

/** 读取岗位能力维度；旧岗位字段为空或 JSON 损坏时统一返回空数组。 */
export async function getCompetencyDimensions(interviewId: string): Promise<CompetencyDimensions> {
  const row = getDb()
    .prepare("SELECT competency_dimensions FROM interview WHERE id = ? LIMIT 1")
    .get(interviewId) as { competency_dimensions?: string | null } | undefined;
  if (!row?.competency_dimensions) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(row.competency_dimensions);
    return Array.isArray(parsed) ? (parsed as CompetencyDimensions) : [];
  } catch {
    return [];
  }
}

export type StartCallSessionInput = {
  interviewId: string;
  callId: string;
  email: string;
  name: string;
  candidateId?: string | null;
  candidateInviteToken?: string | null;
};

export type FinishCallSessionInput = {
  callId: string;
  transcript: string;
  details: unknown;
  clientDuration?: number | null;
  tabSwitchCount?: number | null;
  endReason: CallEndReason;
};

/** 保存候选人同意证据，不在本阶段实现同意页面或业务策略。 */
export async function createConsentRecord(
  input: CreateConsentRecordInput,
): Promise<{ id: number; createdAt: string }> {
  if (!input.interviewId || !input.consentVersion.trim()) {
    throw new Error("同意记录缺少岗位编号或文案版本");
  }

  const result = getDb()
    .prepare(
      `INSERT INTO consent_record
       (interview_id, candidate_id, call_id, candidate_email, candidate_name, consent_version,
        voice_processing_accepted, evaluation_accepted, improvement_accepted,
        user_agent, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.interviewId,
      input.candidateId ?? null,
      input.callId ?? null,
      input.candidateEmail ?? null,
      input.candidateName ?? null,
      input.consentVersion.trim(),
      input.voiceProcessingAccepted ? 1 : 0,
      input.evaluationAccepted ? 1 : 0,
      input.improvementAccepted ? 1 : 0,
      input.userAgent ?? null,
      input.ipHash ?? null,
    );
  const row = getDb()
    .prepare("SELECT id, created_at FROM consent_record WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as { id: number; created_at: string };

  return { id: Number(row.id), createdAt: row.created_at };
}

/** 撤回动作只记录撤回时间，不删除原始同意证据。 */
export async function withdrawConsentRecord(id: number): Promise<boolean> {
  const result = getDb()
    .prepare(
      "UPDATE consent_record SET withdrawn_at = datetime('now') WHERE id = ? AND withdrawn_at IS NULL",
    )
    .run(id);

  return result.changes === 1;
}

/** 从 SQLite 原始行读取 response，避免结束动作前后再次依赖客户端快照。 */
function getRow(callId: string): ResponseRow | null {
  const row = getDb().prepare("SELECT * FROM response WHERE call_id = ? LIMIT 1").get(callId);
  if (!row || typeof row !== "object") {
    return null;
  }

  const value = row as Record<string, any>;
  let details: unknown = null;
  let analytics: unknown = null;

  try {
    details = value.details ? JSON.parse(value.details) : null;
  } catch {
    details = null;
  }
  try {
    analytics = value.analytics ? JSON.parse(value.analytics) : null;
  } catch {
    analytics = null;
  }

  return {
    ...value,
    details,
    analytics,
    is_analysed: value.is_analysed === 1 || value.is_analysed === true,
    is_ended: value.is_ended === 1 || value.is_ended === true,
    is_viewed: value.is_viewed === 1 || value.is_viewed === true,
    analysis_status: value.analysis_status ?? "idle",
    analysis_started_at: value.analysis_started_at ?? null,
  } as ResponseRow;
}

function addMinutes(isoTime: string, minutes: number): string {
  return new Date(new Date(isoTime).getTime() + minutes * 60 * 1000).toISOString();
}

function calculateServerDuration(startedAt: string | null, endedAt: string): number | null {
  if (!startedAt) {
    return null;
  }

  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }

  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildFinalDetails(
  input: FinishCallSessionInput,
  row: ResponseRow,
  endedAt: string,
  serverDuration: number | null,
  endReason: CallEndReason,
): CallData {
  const original = isObject(input.details) ? input.details : {};
  const diagnostics: Record<string, unknown> = isObject(original.diagnostics)
    ? { ...original.diagnostics }
    : {};
  if (typeof input.clientDuration === "number" && Number.isFinite(input.clientDuration)) {
    // 客户端时长只放在诊断区，不能参与 server_duration 或结果页结算。
    diagnostics.client_duration = input.clientDuration;
  }

  return {
    ...original,
    call_id: row.call_id ?? input.callId,
    interview_id: row.interview_id ?? "",
    model: typeof original.model === "string" ? original.model : "",
    voice: typeof original.voice === "string" ? original.voice : "",
    transcript:
      input.transcript || (typeof original.transcript === "string" ? original.transcript : ""),
    transcript_object: Array.isArray(original.transcript_object) ? original.transcript_object : [],
    duration: serverDuration ?? 0,
    server_duration: serverDuration,
    started_at: row.started_at,
    ended_at: endedAt,
    end_reason: endReason,
    diagnostics,
    stats: isObject(original.stats) ? (original.stats as unknown as CallData["stats"]) : undefined,
  } as CallData;
}

/**
 * 只有实时语音客户端成功建立连接后才能调用这里。
 * 开始时间由服务端生成，岗位时长也从数据库读取，避免客户端篡改倒计时规则。
 */
export async function startCallSession(
  input: StartCallSessionInput,
): Promise<CallSessionStartResult> {
  const db = getDb();
  let candidateIdentity: { name: string; email: string } | null = null;
  if (input.candidateId) {
    if (!input.candidateInviteToken) {
      throw new Error("候选人专属链接令牌缺失");
    }
    const candidate = db
      .prepare(
        `SELECT name, email, invite_token FROM candidate_invite
         WHERE id = ? AND interview_id = ? AND revoked_at IS NULL LIMIT 1`,
      )
      .get(input.candidateId, input.interviewId) as
      | { name: string; email: string; invite_token: string }
      | undefined;
    if (!candidate || candidate.invite_token !== input.candidateInviteToken) {
      throw new Error("候选人专属链接校验失败");
    }
    /*
     * 🔒 正式开始的最后一道同意闸门。
     *
     * 不依赖更早的页面 / 接口检查：`startCallSession` 会被候选人浏览器直接触发，
     * 只靠前面的页面拦截或 register-call 校验，等于把安全边界交给客户端。
     * 身份一律取自服务端（令牌 → 邀请记录），不接受客户端提交的姓名 / 邮箱 / 文案版本。
     *
     * ⚠️ 这段只做授权校验，不改变 P0 已冻结的时长、结束与幂等语义。
     */
    assertCandidateConsentForCall({
      inviteToken: input.candidateInviteToken,
      candidateId: input.candidateId,
      interviewId: input.interviewId,
    });
    candidateIdentity = { name: candidate.name, email: candidate.email };
  }
  const existing = getRow(input.callId);
  if (existing) {
    if (existing.interview_id !== input.interviewId) {
      throw new Error("会话编号与岗位不匹配");
    }
    if ((existing.candidate_id ?? null) !== (input.candidateId ?? null)) {
      throw new Error("会话编号与候选人邀请不匹配");
    }
    if (existing.is_ended) {
      throw new Error("该 call_id 已经完成，不能重新开始");
    }

    return {
      response: existing,
      started: Boolean(existing.started_at),
      alreadyStarted: true,
      startedAt: existing.started_at,
      expiresAt: existing.expires_at,
    };
  }

  if (input.candidateId) {
    const candidate = db
      .prepare(
        "SELECT interview_id, status, revoked_at, invite_token FROM candidate_invite WHERE id = ? LIMIT 1",
      )
      .get(input.candidateId) as
      | { interview_id: string; status: string; revoked_at: string | null; invite_token: string }
      | undefined;
    if (
      !candidate ||
      candidate.interview_id !== input.interviewId ||
      candidate.revoked_at ||
      candidate.invite_token !== input.candidateInviteToken ||
      candidate.status !== "ready"
    ) {
      throw new Error("该候选人邀请已失效或已完成面试");
    }
  }

  const interview = db
    .prepare("SELECT time_duration, is_active, is_archived FROM interview WHERE id = ? LIMIT 1")
    .get(input.interviewId) as
    | { time_duration?: string | number | null; is_active?: number; is_archived?: number }
    | undefined;
  if (!interview || !interview.is_active || interview.is_archived) {
    throw new Error("该岗位不存在或当前不可参加面试");
  }
  const minutes = Number(normalizeInterviewDuration(interview?.time_duration));
  const startedAt = new Date().toISOString();
  const expiresAt = addMinutes(startedAt, minutes);

  const sql = `
    INSERT OR IGNORE INTO response
      (interview_id, name, email, call_id, duration, candidate_id, started_at, ended_at,
       server_duration, expires_at, is_analysed, analysis_status, is_ended,
       is_viewed, tab_switch_count)
    VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, 0, 'idle', 0, 0, 0)`;
  const values = [
    input.interviewId,
    candidateIdentity?.name ?? input.name,
    candidateIdentity?.email ?? input.email,
    input.callId,
    input.candidateId ?? null,
    startedAt,
    expiresAt,
  ] as SqliteBinding[];
  const begin = db.transaction(() => {
    const found = getRow(input.callId);
    if (found) {
      if (found.interview_id !== input.interviewId) {
        throw new Error("会话编号与岗位不匹配");
      }
      if ((found.candidate_id ?? null) !== (input.candidateId ?? null)) {
        throw new Error("会话编号与候选人邀请不匹配");
      }
      if (found.is_ended) {
        throw new Error("该 call_id 已经完成，不能重新开始");
      }
      return { response: found, alreadyStarted: true };
    }

    if (input.candidateId) {
      const ready = db
        .prepare(
          `SELECT 1 FROM candidate_invite
           WHERE id = ? AND interview_id = ? AND invite_token = ?
             AND status = 'ready' AND revoked_at IS NULL LIMIT 1`,
        )
        .get(input.candidateId, input.interviewId, input.candidateInviteToken);
      if (!ready) {
        throw new Error("该候选人链接已被使用或撤销，请联系 HR");
      }
    }

    db.prepare(sql).run(...values);
    if (input.candidateId) {
      markCandidateInviteStarted(input.candidateId, input.interviewId, startedAt);
    }
    return { response: getRow(input.callId), alreadyStarted: false };
  });
  const result = begin.immediate();
  const response = result.response;
  if (!response) {
    throw new Error("服务端无法创建面试会话记录");
  }

  return {
    response,
    started: Boolean(response.started_at),
    alreadyStarted: result.alreadyStarted,
    startedAt: response.started_at,
    expiresAt: response.expires_at,
  };
}

/**
 * 幂等完成一次面试。条件更新保证候选人按钮、计时器和连接关闭并发到达时，
 * 只有第一个请求能写入 ended_at；后续请求只读回第一次的最终结果。
 */
export async function finishCallSession(
  input: FinishCallSessionInput,
): Promise<CallSessionFinishResult> {
  const db = getDb();
  const current = getRow(input.callId);
  if (!current) {
    throw new Error("未找到待完成的面试会话");
  }

  if (current.is_ended) {
    return {
      callId: input.callId,
      startedAt: current.started_at,
      endedAt: current.ended_at,
      serverDuration: current.server_duration,
      endReason: getEndReason(current.details, "error"),
      alreadyEnded: true,
      response: current,
    };
  }
  if (!current.started_at) {
    throw new Error("语音连接尚未被服务端确认为正式开始，不能完成面试");
  }

  const endedAt = new Date().toISOString();
  const serverDuration = calculateServerDuration(current.started_at, endedAt);
  const endReason = resolveEndReason(input.endReason, current.expires_at, endedAt);
  const details = buildFinalDetails(input, current, endedAt, serverDuration, endReason);
  if (current.candidate_id) {
    const invite = db
      .prepare("SELECT name, email, questions FROM candidate_invite WHERE id = ? LIMIT 1")
      .get(current.candidate_id) as { name: string; email: string; questions: string } | undefined;
    if (invite) {
      details.candidate_id = current.candidate_id;
      details.interview_questions = (
        JSON.parse(invite.questions) as Array<{ question: string }>
      ).map((question) => question.question);
    }
  }

  const finish = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE response
         SET transcript = ?, details = ?, duration = ?, ended_at = ?, server_duration = ?,
             is_ended = 1, tab_switch_count = ?, analysis_status = 'idle'
         WHERE call_id = ? AND is_ended = 0`,
      )
      .run(
        input.transcript,
        toJsonCol(details),
        serverDuration,
        endedAt,
        serverDuration,
        input.tabSwitchCount ?? 0,
        input.callId,
      );
    if (result.changes === 1 && current.candidate_id) {
      markCandidateInviteCompleted(current.candidate_id, current.interview_id ?? "", endedAt);
    }
    return result;
  });
  const result = finish.immediate();

  const finalRow = getRow(input.callId);
  if (!finalRow) {
    throw new Error("服务端完成面试后无法读取结果");
  }

  // 另一个并发请求可能先完成；此时不得用本次请求的快照覆盖它。
  if (result.changes === 0 || finalRow.ended_at !== endedAt) {
    return {
      callId: input.callId,
      startedAt: finalRow.started_at,
      endedAt: finalRow.ended_at,
      serverDuration: finalRow.server_duration,
      endReason: getEndReason(finalRow.details, "error"),
      alreadyEnded: true,
      response: finalRow,
    };
  }

  return {
    callId: input.callId,
    startedAt: finalRow.started_at,
    endedAt: finalRow.ended_at,
    serverDuration: finalRow.server_duration,
    endReason,
    alreadyEnded: false,
    response: finalRow,
  };
}

function resolveEndReason(
  requested: CallEndReason,
  expiresAt: string | null,
  endedAt: string,
): CallEndReason {
  const isExpired = Boolean(
    expiresAt &&
      Number.isFinite(Date.parse(expiresAt)) &&
      Date.parse(endedAt) >= Date.parse(expiresAt),
  );

  if (requested === "time_up" && !isExpired) {
    throw new Error("岗位面试时长尚未到期，服务端拒绝提前结束计时");
  }

  if (requested !== "error" && isExpired) {
    return "time_up";
  }

  return requested;
}

function getEndReason(details: unknown, fallback: CallEndReason): CallEndReason {
  if (!isObject(details)) {
    return fallback;
  }
  const reason = details.end_reason;
  return reason === "candidate_ended" ||
    reason === "time_up" ||
    reason === "connection_closed" ||
    reason === "error"
    ? reason
    : fallback;
}
