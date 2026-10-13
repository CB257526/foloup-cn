import { getDb } from "@/lib/db";
import type { ConsentSubmitInput, ConsentSubmitResult } from "@/types/candidate";

/**
 * 候选人同意留痕（服务端审计）—— 唯一权威实现。
 *
 * 设计要点（都是从「真出争议时拿不拿得出证据」倒推出来的）：
 *
 * 1. **身份只认服务端**：候选人提交的只有专属令牌 `token`，candidate_id / interview_id /
 *    姓名 / 邮箱全部由服务端从 `candidate_invite` 反查得到。浏览器提交的任何身份字段都不采信，
 *    因此「改个 id 就能把同意写到别人岗位下」这条路直接堵死。
 *
 * 2. **文案版本必须与当前版本一致**。旧版本的同意不能当新版本用：候选人同意的是**当时**那段文案，
 *    文案改版后必须重新确认。所以这里对 `consentVersion` 做严格相等校验（不是"大于等于"）。
 *
 * 3. **幂等写入**。(candidate_id, interview_id, consent_version) 视为一条审计记录：
 *    重复提交同样内容 → 不写第二条，直接复用（避免候选人连点或刷新产生一堆重复行）；
 *    复用记录时若同意项发生变化（例如后补勾了可选项）→ 就地更新该行的布尔值。
 *    ⚠️ 取舍：就地更新意味着同一版本下「同意项的变化历史」不保留（表里没有 updated_at 列，
 *    且 schema 属冻结区域不允许改）。首次同意时间 created_at 保持不动，便于核对"什么时候同意的"。
 *
 * 4. **只保存必要摘要**：user-agent 由服务端从请求头读取后按键值白名单压缩成
 *    「浏览器 · 操作系统」（例如 `Chrome 131 · macOS`），不落原始 UA 串、
 *    更不可能落 API Key / 原始音频 / 完整 IP（IP 一律不采集）。
 */

/** 当前有效的同意文案版本。文案一改就要改这里（并同步升 src/app/(user)/call/[interviewId]/consent.ts 的说明）。 */
export const CURRENT_CONSENT_VERSION = "2026-10-13.v2";

/** 可写入同意状态的前置条件：链接必须是「未使用」状态 */
const CONSENTABLE_STATUS = "ready";

type InviteForConsent = {
  id: string;
  interview_id: string;
  name: string;
  email: string;
  status: string;
  revoked_at: string | null;
};

type ExistingConsent = {
  id: number;
  created_at: string;
  voice_processing_accepted: number;
  evaluation_accepted: number;
  improvement_accepted: number;
};

function toBool(value: unknown): boolean {
  return value === 1 || value === true;
}

/**
 * 逐项校验一个同意项**必须是真正的布尔值**。
 *
 * 为什么不能用 `if (!value)`：Server Action 的入参是网络请求构造出来的，TypeScript 的
 * 类型声明对运行时**没有任何约束力**。而 JavaScript 里 `"false"` 是 truthy、`1` 是 truthy，
 * 于是 `if (!value)` 会把字符串 `"false"`、数字 `1` 当成"已同意"写进审计表 ——
 * 这意味着有人可以手工构造一个请求，在**没勾选**的情况下留下一条"已同意"的假证据。
 * 因此这里要求 `typeof value === "boolean"`，其余一律拒绝。
 */
function readConsentFlag(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`同意项「${label}」格式不正确，无法记录同意`);
  }

  return value;
}

/**
 * 把原始 User-Agent 压缩成最短的必要摘要。
 *
 * 做法是**白名单拼装**而不是截断原文：输出只可能由下面这些固定词组成，
 * 因此即使请求头里被塞进 `sk-...` 之类的密钥、或超长垃圾串，也不可能进入数据库。
 * 无法识别时返回 `"未知客户端"`，而不是把原文透传。
 */
export function summarizeUserAgent(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  const ua = raw.slice(0, 1024);

  let browser = "";
  const edge = /Edg(?:e|A|iOS)?\/(\d+)/.exec(ua);
  const opera = /OPR\/(\d+)/.exec(ua);
  const chrome = /Chrome\/(\d+)/.exec(ua);
  const firefox = /Firefox\/(\d+)/.exec(ua);
  const safari = /Version\/(\d+)[.\d]* Safari/.exec(ua);

  if (edge) {
    browser = `Edge ${edge[1]}`;
  } else if (opera) {
    browser = `Opera ${opera[1]}`;
  } else if (chrome) {
    browser = `Chrome ${chrome[1]}`;
  } else if (firefox) {
    browser = `Firefox ${firefox[1]}`;
  } else if (safari) {
    browser = `Safari ${safari[1]}`;
  }

  let os = "";
  if (/iPhone|iPad|iPod/.test(ua)) {
    os = "iOS";
  } else if (/Android/.test(ua)) {
    os = "Android";
  } else if (/Mac OS X|Macintosh/.test(ua)) {
    os = "macOS";
  } else if (/Windows/.test(ua)) {
    os = "Windows";
  } else if (/Linux/.test(ua)) {
    os = "Linux";
  }

  const parts = [browser, os].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ").slice(0, 60) : "未知客户端";
}

/**
 * 记录一次候选人同意（服务端审计留痕）。
 *
 * 校验顺序刻意是「令牌 → 状态 → 版本」，任何一步不过都抛错、**不写任何行**：
 * 页面据此阻止候选人进入正式面试并给出重试入口。
 */
export async function recordConsentByInviteToken(
  input: ConsentSubmitInput & { userAgent?: string | null },
): Promise<ConsentSubmitResult> {
  // 入口先挡「不是对象」的调用：`{...input}` 对 null/字符串/数组不会报错，
  // 会得到一个字段全缺的假对象，必须在这里明确拒绝。
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("同意请求格式不正确，无法记录同意");
  }

  const token = typeof input.token === "string" ? input.token.trim() : "";

  if (!token || token.length > 80) {
    throw new Error("面试链接无效，无法记录同意");
  }

  const rawVersion = input.consentVersion;
  if (
    typeof rawVersion !== "string" ||
    rawVersion.trim().length === 0 ||
    rawVersion.trim().length > 40
  ) {
    throw new Error("同意文案版本格式不正确，请刷新页面后重试");
  }
  if (rawVersion.trim() !== CURRENT_CONSENT_VERSION) {
    // 旧版本同意不能当新版本用 —— 必须刷新页面重新阅读当前文案
    throw new Error("同意文案已更新，请刷新页面后重新阅读并确认");
  }

  // 三个同意项逐项验类型（见 readConsentFlag 的说明）；两个必选项还必须严格为 true
  const voiceProcessingAccepted = readConsentFlag(input.voiceProcessingAccepted, "语音处理");
  const evaluationAccepted = readConsentFlag(input.evaluationAccepted, "AI 评估与留存知悉");
  const improvementAccepted = readConsentFlag(input.improvementAccepted, "改进用途");

  if (voiceProcessingAccepted !== true || evaluationAccepted !== true) {
    throw new Error("两项必选同意都确认后才能记录同意");
  }

  const version = CURRENT_CONSENT_VERSION;
  const db = getDb();

  const write = db.transaction(() => {
    const invite = db
      .prepare(
        "SELECT id, interview_id, name, email, status, revoked_at FROM candidate_invite WHERE invite_token = ? LIMIT 1",
      )
      .get(token) as InviteForConsent | undefined;

    if (!invite) {
      throw new Error("面试链接无效，无法记录同意");
    }
    if (invite.revoked_at || invite.status === "revoked") {
      throw new Error("该面试链接已被撤销，无法记录同意");
    }
    if (invite.status === "completed") {
      throw new Error("本次面试已完成，无法重复记录同意");
    }
    if (invite.status !== CONSENTABLE_STATUS) {
      // 同意必须发生在开播之前；已进入面试中的链接不再接受同意写入
      throw new Error("本次面试已经开始，无法重复记录同意");
    }

    const existing = db
      .prepare(
        `SELECT id, created_at, voice_processing_accepted, evaluation_accepted, improvement_accepted
         FROM consent_record
         WHERE candidate_id = ? AND interview_id = ? AND consent_version = ?
         ORDER BY id LIMIT 1`,
      )
      .get(invite.id, invite.interview_id, version) as ExistingConsent | undefined;

    // 无论新增还是复用，都把候选人链接上的「已同意版本」推进到当前版本
    db.prepare(
      "UPDATE candidate_invite SET consent_version = ? WHERE id = ? AND interview_id = ?",
    ).run(version, invite.id, invite.interview_id);

    if (existing) {
      const same =
        toBool(existing.voice_processing_accepted) === voiceProcessingAccepted &&
        toBool(existing.evaluation_accepted) === evaluationAccepted &&
        toBool(existing.improvement_accepted) === improvementAccepted;

      if (!same) {
        db.prepare(
          `UPDATE consent_record
           SET voice_processing_accepted = ?, evaluation_accepted = ?, improvement_accepted = ?, user_agent = ?
           WHERE id = ?`,
        ).run(
          voiceProcessingAccepted ? 1 : 0,
          evaluationAccepted ? 1 : 0,
          improvementAccepted ? 1 : 0,
          summarizeUserAgent(input.userAgent),
          existing.id,
        );
      }

      return {
        id: Number(existing.id),
        createdAt: String(existing.created_at),
        duplicate: true,
        updated: !same,
      } satisfies ConsentSubmitResult;
    }

    const inserted = db
      .prepare(
        `INSERT INTO consent_record
         (interview_id, candidate_id, candidate_email, candidate_name, consent_version,
          voice_processing_accepted, evaluation_accepted, improvement_accepted, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        invite.interview_id,
        invite.id,
        invite.email,
        invite.name,
        version,
        voiceProcessingAccepted ? 1 : 0,
        evaluationAccepted ? 1 : 0,
        improvementAccepted ? 1 : 0,
        summarizeUserAgent(input.userAgent),
      );

    const saved = db
      .prepare("SELECT id, created_at FROM consent_record WHERE id = ?")
      .get(Number(inserted.lastInsertRowid)) as { id: number; created_at: string };

    return {
      id: Number(saved.id),
      createdAt: String(saved.created_at),
      duplicate: false,
      updated: false,
    } satisfies ConsentSubmitResult;
  });

  return write.immediate();
}

/** 同意闸门的拒绝原因（稳定短码，可安全写进日志 / 返回给调用方判断） */
export type CandidateConsentRejection =
  | "invalid_token"
  | "identity_mismatch"
  | "revoked"
  | "completed"
  | "version_mismatch"
  | "consent_missing";

export type CandidateConsentVerification =
  | { ok: true; consentId: number }
  | { ok: false; code: CandidateConsentRejection; message: string };

/**
 * 候选人专属链接进入实时语音前的**服务端**同意闸门。
 *
 * 这个函数存在的唯一理由：页面层（包括 localStorage）不是安全边界。
 *   · localStorage 是候选人自己就能改写的本地缓存 —— 拿它当"已同意"的凭据，
 *     等于让候选人自己给自己开绿灯；
 *   · 候选人也可以绕过页面，直接 POST `/api/register-call` 或直接调开始动作。
 * 所以真正的校验必须落在服务端，而且在**把实时语音密钥交出去之前**。
 *
 * 校验内容（任一不满足即拒绝）：
 *   ① 令牌 → 邀请能查到，且 `邀请.id === candidateId`、`邀请.interview_id === interviewId`
 *      —— 三要素互相匹配，防止把 A 的令牌配 B 的候选人编号 / 换到别的岗位；
 *   ② 邀请未被撤销、未完成；
 *   ③ `candidate_invite.consent_version` 等于服务端**当前**文案版本（改版后旧同意不作数）；
 *   ④ 库里存在该「候选人 + 岗位 + 当前版本」的同意留痕，且两项必选为 1、未撤回。
 *
 * 返回结构而**不抛错**：调用方（HTTP 路由）需要据此回一个明确的 403，
 * 而 Server Action 侧则用 `assertCandidateConsentForCall` 转成异常。
 */
export function verifyCandidateConsentForCall(input: {
  inviteToken?: string | null;
  candidateId?: string | null;
  interviewId?: string | null;
}): CandidateConsentVerification {
  const token = typeof input?.inviteToken === "string" ? input.inviteToken.trim() : "";
  const candidateId = typeof input?.candidateId === "string" ? input.candidateId.trim() : "";
  const interviewId = typeof input?.interviewId === "string" ? input.interviewId.trim() : "";

  if (!token || token.length > 80 || !candidateId || !interviewId) {
    return { ok: false, code: "invalid_token", message: "候选人专属链接参数无效" };
  }

  const invite = getDb()
    .prepare(
      `SELECT id, interview_id, status, revoked_at, consent_version
       FROM candidate_invite WHERE invite_token = ? LIMIT 1`,
    )
    .get(token) as
    | {
        id: string;
        interview_id: string;
        status: string;
        revoked_at: string | null;
        consent_version: string | null;
      }
    | undefined;

  if (!invite || invite.id !== candidateId || invite.interview_id !== interviewId) {
    return { ok: false, code: "identity_mismatch", message: "候选人专属链接校验失败" };
  }
  if (invite.revoked_at || invite.status === "revoked") {
    return { ok: false, code: "revoked", message: "该面试链接已被撤销" };
  }
  if (invite.status === "completed") {
    return { ok: false, code: "completed", message: "本次面试已完成" };
  }
  if (invite.consent_version !== CURRENT_CONSENT_VERSION) {
    return {
      ok: false,
      code: "version_mismatch",
      message: "尚未确认当前版本的面试须知，请返回面试页面重新阅读并同意",
    };
  }

  const record = getDb()
    .prepare(
      `SELECT id FROM consent_record
       WHERE candidate_id = ? AND interview_id = ? AND consent_version = ?
         AND voice_processing_accepted = 1 AND evaluation_accepted = 1
         AND withdrawn_at IS NULL
       ORDER BY id LIMIT 1`,
    )
    .get(candidateId, interviewId, CURRENT_CONSENT_VERSION) as { id: number } | undefined;

  if (!record) {
    return {
      ok: false,
      code: "consent_missing",
      message: "未找到有效的同意记录，请返回面试页面重新阅读并同意",
    };
  }

  return { ok: true, consentId: Number(record.id) };
}

/** 同上，但以异常形式表达（供 Server Action / 数据层在流程中间直接中断） */
export function assertCandidateConsentForCall(input: {
  inviteToken?: string | null;
  candidateId?: string | null;
  interviewId?: string | null;
}): void {
  const result = verifyCandidateConsentForCall(input);
  if (!result.ok) {
    throw new Error(result.message);
  }
}
