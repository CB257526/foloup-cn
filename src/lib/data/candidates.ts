import { fromJsonCol, getDb, toJsonCol } from "@/lib/db";
import { decryptResumeText, encryptResumeText } from "@/lib/security/resume-encryption";
import type {
  CandidateInvite,
  CreateCandidateInviteInput,
  PublicCandidateInvite,
} from "@/types/candidate";
import type { Question } from "@/types/interview";
import { removeProctorDataForCalls } from "@/lib/data/proctoring";

export type CandidateInviteListItem = Omit<CandidateInvite, "resume_text" | "questions"> & {
  response_duration: number | null;
  is_analysed: boolean;
};

export type CandidateRegistrationContext = {
  id: string;
  resume_call_id: string | null;
  interview_id: string;
  name: string;
  email: string;
  resume_text: string;
  candidate_description: string;
  questions: Question[];
  status: CandidateInvite["status"];
  invite_token: string;
};

type CandidateRow = Record<string, unknown> & {
  id: string;
  interview_id: string;
  name: string;
  email: string;
  resume_file_name: string;
  resume_text: string;
  candidate_description: string;
  questions: string;
  invite_token: string;
  status: CandidateInvite["status"];
  consent_version: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  revoked_at: string | null;
  call_id?: string | null;
};

function mapCandidate(row: CandidateRow): CandidateInvite {
  return {
    ...row,
    resume_text: decryptResumeText(row.resume_text),
    questions: fromJsonCol<Question[]>(row.questions, []),
    call_id: row.call_id ?? null,
  } as CandidateInvite;
}

function validateInviteInput(input: CreateCandidateInviteInput): void {
  if (!input.interviewId.trim()) {
    throw new Error("缺少岗位编号");
  }
  if (!input.name.trim()) {
    throw new Error("请填写候选人姓名");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    throw new Error("请填写有效的候选人邮箱");
  }
  if (!input.resumeFileName.trim() || !input.resumeText.trim()) {
    throw new Error("请上传可读取内容的 PDF 简历");
  }
  if (input.resumeText.length > 50000) {
    throw new Error("简历正文过长，请使用不超过约 50,000 字符的 PDF");
  }
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    throw new Error("至少需要一道专属面试题");
  }
  if (input.questions.some((question) => !question.question.trim())) {
    throw new Error("面试题不能为空");
  }
}

/** 创建一个候选人专属邀请；岗位模板本身不保存候选人简历或专属问题。 */
export async function createCandidateInvite(
  input: CreateCandidateInviteInput,
  id: string,
  inviteToken: string,
): Promise<CandidateInvite> {
  validateInviteInput(input);
  const db = getDb();
  const create = db.transaction(() => {
    const interview = db
      .prepare("SELECT is_active, is_archived FROM interview WHERE id = ? LIMIT 1")
      .get(input.interviewId) as { is_active?: number; is_archived?: number } | undefined;
    if (!interview || interview.is_archived) {
      throw new Error("岗位不存在或已归档，暂时不能生成候选人链接");
    }

    const duplicate = db
      .prepare(
        `SELECT id FROM candidate_invite
         WHERE interview_id = ? AND lower(email) = lower(?) AND revoked_at IS NULL LIMIT 1`,
      )
      .get(input.interviewId, input.email.trim());
    if (duplicate) {
      throw new Error("该邮箱已经添加到此岗位；如需重新邀请，请先撤销旧链接");
    }

    db.prepare(
      `INSERT INTO candidate_invite
       (id, interview_id, name, email, resume_file_name, resume_text,
        candidate_description, questions, invite_token, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
    ).run(
      id,
      input.interviewId,
      input.name.trim(),
      input.email.trim().toLowerCase(),
      input.resumeFileName.trim(),
      encryptResumeText(input.resumeText.trim()),
      input.candidateDescription.trim(),
      toJsonCol(input.questions),
      inviteToken,
    );
  });
  create.immediate();

  const row = db.prepare("SELECT * FROM candidate_invite WHERE id = ? LIMIT 1").get(id) as
    | CandidateRow
    | undefined;
  if (!row) {
    throw new Error("候选人邀请保存失败");
  }
  return mapCandidate(row);
}

/** 岗位页只读取简历文件名与状态，不把简历全文下发到候选人清单。 */
export async function getCandidateInvitesForInterview(
  interviewId: string,
): Promise<CandidateInviteListItem[]> {
  const rows = getDb()
    .prepare(
      `SELECT c.*, r.call_id, r.duration AS response_duration, r.is_analysed
       FROM candidate_invite c
       LEFT JOIN response r ON r.id = (
         SELECT id FROM response
         WHERE candidate_id = c.id
         ORDER BY is_ended DESC, rowid DESC LIMIT 1
       )
       WHERE c.interview_id = ?
       ORDER BY c.created_at DESC, c.rowid DESC`,
    )
    .all(interviewId) as Array<
    CandidateRow & { response_duration: number | null; is_analysed: number | null }
  >;

  return rows.map((row) => {
    const { resume_text, questions, is_analysed, response_duration, ...candidate } = row;
    return {
      ...candidate,
      is_analysed: is_analysed === 1,
      response_duration: response_duration ?? null,
    } as CandidateInviteListItem;
  });
}

/** HR 点击候选人资料时读取完整简历；该动作只在后台候选人工作台调用。 */
export async function getCandidateInviteById(
  id: string,
  interviewId: string,
): Promise<CandidateInvite | null> {
  const row = getDb()
    .prepare("SELECT * FROM candidate_invite WHERE id = ? AND interview_id = ? LIMIT 1")
    .get(id, interviewId) as CandidateRow | undefined;
  return row ? mapCandidate(row) : null;
}

/** 通过随机邀请令牌查候选人资料；返回内容仅用于该候选人的专属面试页。 */
export async function getPublicCandidateInviteByToken(
  token: string,
): Promise<PublicCandidateInvite | null> {
  if (!token || token.length > 80) {
    return null;
  }
  const row = getDb()
    .prepare("SELECT * FROM candidate_invite WHERE invite_token = ? LIMIT 1")
    .get(token) as CandidateRow | undefined;
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    interview_id: row.interview_id,
    name: row.name,
    email: row.email,
    resume_file_name: row.resume_file_name,
    candidate_description: row.candidate_description,
    questions: fromJsonCol<Question[]>(row.questions, []),
    status: row.status,
    consent_version: row.consent_version,
    started_at: row.started_at,
    completed_at: row.completed_at,
    revoked_at: row.revoked_at,
  };
}

/** 通过专属令牌读取语音签发上下文，简历全文只在服务端注入语音提示词。 */
export async function getCandidateRegistrationContextByToken(
  inviteToken: string,
  interviewId: string,
): Promise<CandidateRegistrationContext | null> {
  const row = getDb()
    .prepare(
      `SELECT c.*,
              (SELECT r.call_id FROM response r
               WHERE r.candidate_id = c.id AND r.is_ended = 0
               ORDER BY r.rowid DESC LIMIT 1) AS resume_call_id
       FROM candidate_invite c
       WHERE c.invite_token = ? AND c.interview_id = ? LIMIT 1`,
    )
    .get(inviteToken, interviewId) as
    | (CandidateRow & { resume_call_id?: string | null })
    | undefined;
  if (!row || row.revoked_at || row.status === "revoked" || row.status === "completed") {
    return null;
  }
  if (row.status === "in_progress" && !row.resume_call_id) {
    return null;
  }

  return {
    id: row.id,
    resume_call_id: row.resume_call_id ?? null,
    interview_id: row.interview_id,
    name: row.name,
    email: row.email,
    resume_text: decryptResumeText(row.resume_text),
    candidate_description: row.candidate_description,
    questions: fromJsonCol<Question[]>(row.questions, []),
    status: row.status,
    invite_token: row.invite_token,
  };
}

/** 撤销未完成的链接；已完成的面试记录保留，不通过撤销动作删除结果。 */
export async function revokeCandidateInvite(id: string, interviewId: string): Promise<boolean> {
  const result = getDb()
    .prepare(
      `UPDATE candidate_invite
       SET status = 'revoked', revoked_at = datetime('now')
       WHERE id = ? AND interview_id = ? AND status = 'ready'`,
    )
    .run(id, interviewId);
  return result.changes === 1;
}

/** 记录该候选人已阅读并同意的版本，以便 HR 后续核查。 */
export async function saveCandidateConsentVersion(
  id: string,
  interviewId: string,
  consentVersion: string,
): Promise<boolean> {
  const result = getDb()
    .prepare(
      `UPDATE candidate_invite SET consent_version = ?
       WHERE id = ? AND interview_id = ? AND revoked_at IS NULL`,
    )
    .run(consentVersion, id, interviewId);
  return result.changes === 1;
}

/** 同一笔 SQLite 事务同时保存候选人同意版本和审计记录。 */
export async function recordCandidateConsent(input: {
  id: string;
  interviewId: string;
  consentVersion: string;
  voiceProcessingAccepted: boolean;
  evaluationAccepted: boolean;
  cameraMonitoringAccepted: boolean;
  improvementAccepted: boolean;
  userAgent?: string | null;
}): Promise<{ id: number; createdAt: string }> {
  if (!input.consentVersion.trim()) {
    throw new Error("缺少同意文案版本");
  }
  const db = getDb();
  const record = db.transaction(() => {
    const candidate = db
      .prepare(
        `SELECT name, email FROM candidate_invite
         WHERE id = ? AND interview_id = ? AND revoked_at IS NULL LIMIT 1`,
      )
      .get(input.id, input.interviewId) as { name: string; email: string } | undefined;
    if (!candidate) {
      throw new Error("候选人链接已失效，无法记录同意");
    }

    db.prepare(
      "UPDATE candidate_invite SET consent_version = ? WHERE id = ? AND interview_id = ?",
    ).run(input.consentVersion.trim(), input.id, input.interviewId);
    const result = db
      .prepare(
        `INSERT INTO consent_record
         (interview_id, candidate_id, candidate_email, candidate_name, consent_version,
          voice_processing_accepted, evaluation_accepted, camera_monitoring_accepted,
          improvement_accepted, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.interviewId,
        input.id,
        candidate.email,
        candidate.name,
        input.consentVersion.trim(),
        input.voiceProcessingAccepted ? 1 : 0,
        input.evaluationAccepted ? 1 : 0,
        input.cameraMonitoringAccepted ? 1 : 0,
        input.improvementAccepted ? 1 : 0,
        input.userAgent ?? null,
      );
    const saved = db
      .prepare("SELECT id, created_at FROM consent_record WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as { id: number; created_at: string };
    return { id: Number(saved.id), createdAt: saved.created_at };
  });
  return record.immediate();
}

/** 候选人确认自助删除后，同一事务清除简历、邀请、关联面试结果与同意留痕。 */
export async function deleteCandidatePersonalData(
  id: string,
  interviewId: string,
): Promise<number> {
  const db = getDb();
  const callIds = (db.prepare("SELECT call_id FROM response WHERE candidate_id = ? AND interview_id = ? AND call_id IS NOT NULL")
    .all(id, interviewId) as Array<{ call_id: string }>).map((row) => row.call_id);
  removeProctorDataForCalls(callIds);
  const remove = db.transaction(() => {
    const exists = db
      .prepare("SELECT 1 FROM candidate_invite WHERE id = ? AND interview_id = ? LIMIT 1")
      .get(id, interviewId);
    if (!exists) {
      return 0;
    }

    const candidate = db
      .prepare("SELECT email FROM candidate_invite WHERE id = ? AND interview_id = ? LIMIT 1")
      .get(id, interviewId) as { email: string } | undefined;
    if (!candidate) {
      return 0;
    }
    const responseCount = db
      .prepare("SELECT COUNT(*) AS count FROM response WHERE candidate_id = ? AND interview_id = ?")
      .get(id, interviewId) as { count: number };
    const feedbackCount = db
      .prepare(
        "SELECT COUNT(*) AS count FROM feedback WHERE interview_id = ? AND lower(email) = lower(?)",
      )
      .get(interviewId, candidate.email) as { count: number };
    db.prepare("DELETE FROM response WHERE candidate_id = ? AND interview_id = ?").run(
      id,
      interviewId,
    );
    db.prepare("DELETE FROM feedback WHERE interview_id = ? AND lower(email) = lower(?)").run(
      interviewId,
      candidate.email,
    );
    db.prepare("DELETE FROM consent_record WHERE candidate_id = ? AND interview_id = ?").run(
      id,
      interviewId,
    );
    db.prepare("DELETE FROM candidate_invite WHERE id = ? AND interview_id = ?").run(
      id,
      interviewId,
    );
    return Math.max(1, Number(responseCount.count) + Number(feedbackCount.count));
  });
  return remove.immediate();
}

/** 候选人成功接通语音后更新专属链接状态；开始时间仍由会话动作生成。 */
export function markCandidateInviteStarted(
  id: string,
  interviewId: string,
  startedAt: string,
): void {
  getDb()
    .prepare(
      `UPDATE candidate_invite
       SET status = 'in_progress', started_at = COALESCE(started_at, ?)
       WHERE id = ? AND interview_id = ? AND status = 'ready'`,
    )
    .run(startedAt, id, interviewId);
}

/** 面试完成后标记链接已使用，最终结果通过 response.candidate_id 关联。 */
export function markCandidateInviteCompleted(
  id: string,
  interviewId: string,
  endedAt: string,
): void {
  getDb()
    .prepare(
      `UPDATE candidate_invite
       SET status = 'completed', completed_at = COALESCE(completed_at, ?)
       WHERE id = ? AND interview_id = ? AND status = 'in_progress'`,
    )
    .run(endedAt, id, interviewId);
}
