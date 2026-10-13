import { createHash } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

/**
 * 个人信息留存到期清理（服务端）—— 只做「已完成面试 + 超过留存期」这一类，
 * 默认只报告不删除。
 *
 * 为什么必须和「面试会话到期」分开（这是 D-9 的核心）：
 *   · `response.expires_at` 表示的是**本次面试会话的时间上限**（开始时间 + 岗位分钟数），
 *     它在一场 20/40 分钟的面试结束时就已过去，用它删数据 = 面试刚结束就删掉候选人的逐字稿。
 *   · 个人信息到期只认「结束时间 + 自然月留存期」：
 *     优先 `candidate_invite.completed_at`，兜底同一候选人已结束 response 的 `ended_at`。
 *
 * 保守原则（宁可漏删，不可猜着删）：
 *   · 未使用（ready / 无 started_at）、面试中（in_progress）、已撤销（revoked）、
 *     状态不明、缺少结束时间的邀请一律**跳过并计数**，绝不凭 expires_at 猜测。
 *   · 历史 legacy response（`candidate_id IS NULL`）没有可靠的候选人关联与结束时间，
 *     同样跳过并计数。
 *   · 反馈（feedback）表只能按「岗位 + 邮箱」关联，无法证明属于同一位候选人，
 *     因此在保留政策确认前**一律不删**，只计数。
 */

type Db = BetterSqlite3.Database;

/** 是否允许真实删除：要求 RETENTION_DELETE_ENABLED=1 且 RETENTION_DRY_RUN=0 */
export type RetentionConfig = {
  /** RETENTION_DELETE_ENABLED 解析结果（默认 false） */
  enabled: boolean;
  /** 是否 dry-run（默认 true，即不删） */
  dryRun: boolean;
  /** 留存期（自然月） */
  months: number;
  /** enabled && !dryRun */
  deleteAllowed: boolean;
  /** 配置原值与解析问题，写日志用（便于解释"为什么没删"） */
  notes: string[];
};

const TRUE_VALUES = ["1", "true", "yes", "on"];
const FALSE_VALUES = ["0", "false", "no", "off"];

const DEFAULT_RETENTION_MONTHS = 6;

/**
 * 留存月数的合法区间。
 *
 * ⚠️ 下限必须是 1：`months = 0` 表示 cutoff = 现在，也就是"面试一结束就算到期" ——
 *    刚做完的面试会被直接列入删除候选。历史上这里的判断是 `parsed > 0` 之后 `Math.floor`，
 *    于是 `RETENTION_MONTHS=0.5` 先通过检查、再被取整成 0，正好触发这个最坏情况。
 *    现在只接受 1~600 的**整数**，小数/0/负数/非数字/超上限一律回落到默认值。
 */
export const MIN_RETENTION_MONTHS = 1;
export const MAX_RETENTION_MONTHS = 600;

function readSwitch(
  raw: string | undefined,
  fallback: boolean,
  notes: string[],
  name: string,
): boolean {
  const value = (raw ?? "").trim().toLowerCase();

  if (value === "") {
    return fallback;
  }
  if (TRUE_VALUES.includes(value)) {
    return true;
  }
  if (FALSE_VALUES.includes(value)) {
    return false;
  }
  notes.push(`${name}="${raw}" 不是有效开关值（只认 1/0、true/false），已按最保守取值处理`);
  return fallback;
}

/** 解析保留清理配置。非法值一律往「更安全」的方向回落（关闭、dry-run、6 个月）。 */
export function resolveRetentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  const notes: string[] = [];

  const enabled = readSwitch(
    env.RETENTION_DELETE_ENABLED,
    false,
    notes,
    "RETENTION_DELETE_ENABLED",
  );
  // 注意：dry-run 默认 true —— 只有显式写 0 才会真正删除
  const dryRun = readSwitch(env.RETENTION_DRY_RUN, true, notes, "RETENTION_DRY_RUN");

  const rawMonths = (env.RETENTION_MONTHS ?? env.NEXT_PUBLIC_DATA_RETENTION_MONTHS ?? "").trim();
  let months = DEFAULT_RETENTION_MONTHS;
  if (rawMonths !== "") {
    const parsed = Number(rawMonths);
    // 只接受 1~600 的整数：Number.isInteger 同时挡掉小数（0.5 / 6.5）与非数字（abc → NaN）
    if (
      Number.isInteger(parsed) &&
      parsed >= MIN_RETENTION_MONTHS &&
      parsed <= MAX_RETENTION_MONTHS
    ) {
      months = parsed;
    } else {
      notes.push(
        `留存月数 "${rawMonths}" 非法（只接受 ${MIN_RETENTION_MONTHS}~${MAX_RETENTION_MONTHS} 的整数），已回落为默认 ${DEFAULT_RETENTION_MONTHS} 个月`,
      );
    }
  }
  // 双保险：即使将来有人改坏了上面的分支，也绝不让 months 落到 0 或负数
  //（0 意味着"结束即到期"，属于最危险的取值）
  months = Math.max(MIN_RETENTION_MONTHS, Math.min(MAX_RETENTION_MONTHS, months));

  return { enabled, dryRun, months, deleteAllowed: enabled && !dryRun, notes };
}

/** 只解析留存月数（同意页展示「保存 N 个月」用，与清理脚本共用同一来源，避免两处不一致） */
export function resolveRetentionMonths(env: NodeJS.ProcessEnv = process.env): number {
  return resolveRetentionConfig(env).months;
}

/**
 * 解析 SQLite 里的时间字符串。
 *
 * ⚠️ 库里混着两种格式：应用写入的是 ISO（`...T...Z`），而 `datetime('now')` 写的是
 *    `YYYY-MM-DD HH:MM:SS`（UTC 但**没有时区标记**）。
 *    后者直接交给 `Date.parse` 会被当成本地时间，产生时区偏移 —— 所以这里补上 Z 再解析。
 */
export function parseDbTime(value: string | null | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!text) {
    return null;
  }
  const normalized = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 按自然月回推（日对齐，且不越过目标月的最后一天） */
export function monthsAgo(from: Date, months: number): Date {
  const target = new Date(from.getTime());
  const day = target.getUTCDate();

  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));

  return target;
}

/**
 * 候选人 id 的不可逆摘要（日志用）。
 * candidate_id 本身是不可猜测的随机串，sha256 截断后仅用于「同一候选人前后两条日志能对上」，
 * 不构成身份信息，也无法反推。
 */
export function hashCandidateId(id: string): string {
  return createHash("sha256").update(String(id)).digest("hex").slice(0, 12);
}

/**
 * 把异常归类成**稳定短码**，用于日志与报告。
 *
 * ⚠️ 为什么不能直接记 `error.message`：数据库异常的 message 里经常带着 SQL 语句、
 *    表名甚至绑定参数片段（也就可能带邮箱、逐字稿的开头），直接落日志会破坏
 *    「日志不记录敏感内容」这条对候选人的承诺。所以这里只映射成分类：
 *      · SQLite 驱动自带的 `SQLITE_*` 错误码本身是分类而非内容 → `sqlite:SQLITE_XXX`；
 *      · 已知的内建异常类名 → `error:TypeError` 这类；
 *      · 其余一律 `unknown_error`（不透传任何原文）。
 */
export function classifyRetentionError(error: unknown): string {
  const rawCode =
    typeof (error as { code?: unknown } | null)?.code === "string"
      ? String((error as { code: string }).code)
      : "";
  if (/^SQLITE_[A-Z0-9_]+$/.test(rawCode)) {
    return `sqlite:${rawCode}`;
  }

  const allowedErrorNames = ["Error", "TypeError", "RangeError", "SqliteError"];
  const rawName =
    typeof (error as { name?: unknown } | null)?.name === "string"
      ? String((error as { name: string }).name)
      : "";
  if (allowedErrorNames.includes(rawName)) {
    return `error:${rawName}`;
  }

  return "unknown_error";
}

/** 跳过原因枚举（写进报告，便于主控核对"为什么这条没被删"） */
export type RetentionSkipReason =
  | "not_used"
  | "in_progress"
  | "revoked_policy_unconfirmed"
  | "unknown_status"
  | "missing_end_time"
  | "not_expired"
  | "session_still_open";

export type EligibleCandidate = {
  id: string;
  interviewId: string;
  completedAt: string;
  completedAtMs: number;
};

export type RetentionScan = {
  scannedCandidates: number;
  eligible: EligibleCandidate[];
  /** 各跳过原因的数量（不含 eligible） */
  skipped: Partial<Record<RetentionSkipReason, number>>;
  /** 无候选人关联的历史 response（candidate_id 为空）—— 跳过，不猜 */
  legacyResponsesSkipped: number;
  /** candidate_id 指向已不存在的邀请（数据不完整）—— 跳过，不猜 */
  orphanResponsesSkipped: number;
  /** 同岗位反馈记录（按 email 关联，保留政策未确认）—— 只计数不删 */
  feedbackRowsPending: number;
};

type InviteScanRow = {
  id: string;
  interview_id: string;
  email: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  revoked_at: string | null;
};

/**
 * 找出「已完成且已过留存期」的候选人。只读，不写库。
 * 传入 `now` 便于用固定时间做可复现验证。
 */
export function findExpiredCandidates(
  db: Db,
  config: RetentionConfig,
  now: Date = new Date(),
): RetentionScan {
  const cutoffMs = monthsAgo(now, config.months).getTime();
  const rows = db
    .prepare(
      `SELECT id, interview_id, email, status, started_at, completed_at, revoked_at
       FROM candidate_invite ORDER BY rowid`,
    )
    .all() as InviteScanRow[];

  const skipped: Partial<Record<RetentionSkipReason, number>> = {};
  const bump = (reason: RetentionSkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  const eligible: EligibleCandidate[] = [];
  let feedbackRowsPending = 0;

  for (const row of rows) {
    if (row.revoked_at || row.status === "revoked") {
      // 已撤销但没有明确业务保留政策 → 不猜着删
      bump("revoked_policy_unconfirmed");
      continue;
    }
    if (row.status === "in_progress") {
      bump("in_progress");
      continue;
    }
    if (row.status === "ready" || !row.started_at) {
      bump("not_used");
      continue;
    }
    if (row.status !== "completed") {
      bump("unknown_status");
      continue;
    }

    const completedMs = parseDbTime(row.completed_at);
    if (completedMs === null) {
      // 缺少可靠结束时间 → 跳过并计数（绝不拿 expires_at 顶替）
      bump("missing_end_time");
      continue;
    }
    if (completedMs >= cutoffMs) {
      bump("not_expired");
      continue;
    }

    // 防御：该候选人若还有未结束的会话，说明状态不一致，不要动
    const open = db
      .prepare(
        `SELECT COUNT(*) AS count FROM response
         WHERE candidate_id = ? AND interview_id = ? AND is_ended = 0`,
      )
      .get(row.id, row.interview_id) as { count: number };
    if (Number(open.count) > 0) {
      bump("session_still_open");
      continue;
    }

    const feedback = db
      .prepare(
        "SELECT COUNT(*) AS count FROM feedback WHERE interview_id = ? AND lower(email) = lower(?)",
      )
      .get(row.interview_id, row.email) as { count: number };
    feedbackRowsPending += Number(feedback.count);

    eligible.push({
      id: row.id,
      interviewId: row.interview_id,
      completedAt: String(row.completed_at),
      completedAtMs: completedMs,
    });
  }

  const legacy = db
    .prepare("SELECT COUNT(*) AS count FROM response WHERE candidate_id IS NULL")
    .get() as { count: number };
  const orphan = db
    .prepare(
      `SELECT COUNT(*) AS count FROM response r
       WHERE r.candidate_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM candidate_invite c WHERE c.id = r.candidate_id)`,
    )
    .get() as { count: number };

  return {
    scannedCandidates: rows.length,
    eligible,
    skipped,
    legacyResponsesSkipped: Number(legacy.count),
    orphanResponsesSkipped: Number(orphan.count),
    feedbackRowsPending,
  };
}

export type PurgeCounts = {
  response: number;
  consent_record: number;
  /** 含加密简历、专属题目、令牌、候选人信息 */
  candidate_invite: number;
};

/**
 * 精确删除一条候选人的个人信息。
 *
 * 全部用 `candidate_id + interview_id` 双条件定位，因此**不会**误伤：
 *   · 其他岗位的同名/同邮箱候选人；
 *   · 同岗位下其他候选人的新邀请；
 *   · 其他候选人的逐字稿与评分。
 *
 * feedback 表只有 (interview_id, email) 两列可用，无法证明归属，故**不在删除范围内**
 * （保留政策待公司确认，见报告里的 feedbackRowsPending）。
 */
export function purgeCandidate(db: Db, candidateId: string, interviewId: string): PurgeCounts {
  const tx = db.transaction(() => {
    const invite = db
      .prepare("SELECT id FROM candidate_invite WHERE id = ? AND interview_id = ? LIMIT 1")
      .get(candidateId, interviewId);
    if (!invite) {
      return { response: 0, consent_record: 0, candidate_invite: 0 } satisfies PurgeCounts;
    }

    const responses = db
      .prepare("DELETE FROM response WHERE candidate_id = ? AND interview_id = ?")
      .run(candidateId, interviewId);
    const consents = db
      .prepare("DELETE FROM consent_record WHERE candidate_id = ? AND interview_id = ?")
      .run(candidateId, interviewId);
    const invites = db
      .prepare("DELETE FROM candidate_invite WHERE id = ? AND interview_id = ?")
      .run(candidateId, interviewId);

    return {
      response: Number(responses.changes),
      consent_record: Number(consents.changes),
      candidate_invite: Number(invites.changes),
    } satisfies PurgeCounts;
  });

  return tx.immediate();
}

export type RetentionReport = {
  generatedAt: string;
  /** dry-run = 只报告；delete = 真删除了 */
  mode: "dry-run" | "delete";
  /** 报告里同时给出客户端无法篡改的服务端开关快照 */
  config: {
    enabled: boolean;
    dryRun: boolean;
    months: number;
    deleteAllowed: boolean;
    applyRequested: boolean;
    notes: string[];
  };
  cutoff: string;
  scan: RetentionScan;
  purgedCandidates: number;
  purged: PurgeCounts;
  failures: Array<{ candidate: string; reason: string }>;
  durationMs: number;
};

/** 把报告压成一行日志：只有数量与不可逆哈希，绝不含姓名/邮箱/简历/逐字稿/令牌/密钥/prompt。 */
export function formatRetentionLog(report: RetentionReport): string {
  return JSON.stringify({
    tag: "retention-cleanup",
    mode: report.mode,
    months: report.config.months,
    deleteAllowed: report.config.deleteAllowed,
    cutoff: report.cutoff,
    scanned: report.scan.scannedCandidates,
    eligible: report.scan.eligible.length,
    skipped: report.scan.skipped,
    legacyResponsesSkipped: report.scan.legacyResponsesSkipped,
    orphanResponsesSkipped: report.scan.orphanResponsesSkipped,
    feedbackRowsPending: report.scan.feedbackRowsPending,
    purgedCandidates: report.purgedCandidates,
    purged: report.purged,
    failures: report.failures,
    notes: report.config.notes,
    durationMs: report.durationMs,
  });
}

/**
 * 执行一次留存清理。
 *
 * 真实删除需要**同时**满足：调用方显式 `apply: true`（脚本 `--apply` / 内部路由 body）
 * 且服务端开关 `RETENTION_DELETE_ENABLED=1` 且 `RETENTION_DRY_RUN=0`。
 * 任一不满足都只产出报告，不做任何写操作 —— 因此「打开页面」或普通请求不可能触发删除。
 */
export function runRetentionCleanup(
  db: Db,
  options: { apply?: boolean; now?: Date } = {},
): RetentionReport {
  const startedAt = Date.now();
  const config = resolveRetentionConfig();
  const now = options.now ?? new Date();
  const applyRequested = options.apply === true;
  const deleting = applyRequested && config.deleteAllowed;

  const scan = findExpiredCandidates(db, config, now);
  const purged: PurgeCounts = { response: 0, consent_record: 0, candidate_invite: 0 };
  const failures: Array<{ candidate: string; reason: string }> = [];
  let purgedCandidates = 0;

  if (deleting) {
    for (const candidate of scan.eligible) {
      try {
        const counts = purgeCandidate(db, candidate.id, candidate.interviewId);
        purged.response += counts.response;
        purged.consent_record += counts.consent_record;
        purged.candidate_invite += counts.candidate_invite;
        if (counts.candidate_invite > 0) {
          purgedCandidates += 1;
        }
      } catch (error) {
        // 只记「候选人不可逆哈希 + 稳定错误分类」，不记异常原文
        //（数据库异常的 message 可能夹带 SQL / 参数 / 候选人数据，见 classifyRetentionError 说明）
        failures.push({
          candidate: hashCandidateId(candidate.id),
          reason: classifyRetentionError(error),
        });
      }
    }
  }

  return {
    generatedAt: now.toISOString(),
    mode: deleting ? "delete" : "dry-run",
    config: {
      enabled: config.enabled,
      dryRun: config.dryRun,
      months: config.months,
      deleteAllowed: config.deleteAllowed,
      applyRequested,
      notes: config.notes,
    },
    cutoff: monthsAgo(now, config.months).toISOString(),
    scan,
    purgedCandidates,
    purged,
    failures,
    durationMs: Date.now() - startedAt,
  };
}
