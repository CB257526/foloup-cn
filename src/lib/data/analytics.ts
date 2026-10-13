import { randomUUID } from "node:crypto";
import { getCandidateInvitesForInterview } from "@/lib/data/candidates";
import { getInterviewById } from "@/lib/data/interviews";
import { getAllResponses } from "@/lib/data/responses";
import { fromJsonCol, getDb, toJsonCol } from "@/lib/db";
import { resolveCompetencyDimensions } from "@/types/interview";
import type {
  AnalysisErrorInfo,
  AnalysisFailureCode,
  Analytics,
  CallData,
  CompetencyDimension,
  CompetencyEvidence,
  CompetencyScore,
  TranscriptTurn,
} from "@/types/response";
import { CALL_END_REASON_TEXT, normalizeTranscriptForMatch } from "@/types/response";

/**
 * 后续 P1 · 评分证据链与结果导出的服务端辅助。
 *
 * 分成三类，都不修改 P0 冻结的 `lib/data/responses.ts`：
 *   1. **纯函数**：结构化评分归一化 + 证据回查逐字稿（可单测，不碰数据库）；
 *   2. **评分任务**：在 `response` 表已有的 `analysis_status` / `analysis_started_at` 上做原子 UPDATE，
 *      并用 `details.diagnostics.analysis_task` 里的任务标识做所有权校验，
 *      支持「重新评分」、卡死恢复，且迟到的旧任务无法覆盖新任务；
 *   3. **导出**：从真实的 response / candidate_invite 组装 CSV，绝不写入演示数据。
 *
 * ⚠️ 为什么失败原因写在 `response.details.diagnostics.analysis_error` 而不是新增列：
 *    `db.ts` / `schema.sqlite.sql` 属 P0 冻结文件，本任务不允许改表结构。
 *    `details` 本来就是 JSON 透传列，放诊断信息不改变任何既有读取契约。
 */

/* ------------------------------------------------------------------ */
/* 一、纯函数：结构化评分归一化                                         */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** 匹配用的归一化与结果页共用同一份实现（见 `@/types/response`），避免两处规则漂移。 */
function normalizeForMatch(text: string): string {
  return normalizeTranscriptForMatch(text);
}

/** 维度的对齐键：忽略空白差异（模型偶尔会在名称里多打空格）。 */
function dimensionKey(name: string): string {
  return name.replace(/\s+/g, "");
}

/**
 * 用**候选人本人**（`role=user`）的逐字稿轮次核验证据引用。
 *
 * - 只有能在候选人发言里找到的引用才会保留；
 * - `transcriptOffsetMs` 取该轮次真实的 `offset_ms`，取不到就是 `null`（UI 显示「位置未知」）；
 * - 没有结构化逐字稿时**不保留任何证据**（无法确认是不是候选人说的 ⇒ 宁缺毋滥）。
 */
export function buildVerifiedEvidence(
  rawEvidence: unknown,
  transcriptObject: TranscriptTurn[] | null | undefined,
): CompetencyEvidence[] {
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
    return [];
  }
  if (!Array.isArray(transcriptObject) || transcriptObject.length === 0) {
    return [];
  }

  const userTurns = transcriptObject.filter(
    (turn): turn is TranscriptTurn =>
      isRecord(turn) &&
      turn.role === "user" &&
      typeof turn.content === "string" &&
      !!turn.content.trim(),
  );
  if (userTurns.length === 0) {
    return [];
  }

  const verified: CompetencyEvidence[] = [];
  const seen = new Set<string>();

  for (const item of rawEvidence) {
    if (!isRecord(item)) {
      continue;
    }
    const quote = asString(item.quote).trim();
    const normalizedQuote = normalizeForMatch(quote);
    // 过短的引用无法可靠定位，容易误命中，直接丢弃。
    if (normalizedQuote.length < 4) {
      continue;
    }
    const hit = userTurns.find((turn) => normalizeForMatch(turn.content).includes(normalizedQuote));
    if (!hit) {
      continue;
    }
    if (seen.has(normalizedQuote)) {
      continue;
    }
    seen.add(normalizedQuote);
    verified.push({ quote, transcriptOffsetMs: toFiniteNumber(hit.offset_ms) });
    if (verified.length >= 5) {
      break;
    }
  }

  return verified;
}

/**
 * 按岗位配置的维度对齐模型输出。
 *
 * - 只保留岗位配置过的维度（模型新增的维度被忽略并写入 warnings）；
 * - 模型漏掉的维度保留维度名，但 `score=null`、`evidenceStatus='missing'`，不伪造分数；
 * - 顺序与岗位配置一致，便于 HR 逐项对照。
 */
export function buildCompetencyScores(
  rawScores: unknown,
  dimensions: CompetencyDimension[],
  transcriptObject: TranscriptTurn[] | null | undefined,
  warnings: string[],
): CompetencyScore[] {
  const rawByKey = new Map<string, Record<string, unknown>>();
  if (Array.isArray(rawScores)) {
    for (const item of rawScores) {
      if (!isRecord(item)) {
        continue;
      }
      const name = asString(item.name).trim();
      const key = dimensionKey(name);
      if (!key || rawByKey.has(key)) {
        continue;
      }
      rawByKey.set(key, item);
    }
  }

  const configuredKeys = new Set(dimensions.map((dimension) => dimensionKey(dimension.name)));
  // 不用 `[...map.keys()]`：target=es5 且未开 downlevelIteration，展开迭代器会编译报错。
  const unexpected = Array.from(rawByKey.keys()).filter((key) => !configuredKeys.has(key));
  if (unexpected.length > 0) {
    warnings.push(`已忽略岗位未配置的维度：${unexpected.join("、")}`);
  }

  return dimensions.map((dimension) => {
    const found = rawByKey.get(dimensionKey(dimension.name));
    if (!found) {
      return {
        name: dimension.name,
        score: null,
        feedback: "",
        evidence: [],
        riskFlags: [],
        evidenceStatus: "missing" as const,
      };
    }

    const score = toFiniteNumber(found.score);
    const evidence = buildVerifiedEvidence(found.evidence, transcriptObject);
    const riskFlags = Array.isArray(found.riskFlags)
      ? found.riskFlags
          .map((flag) => asString(flag).trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];

    return {
      name: dimension.name,
      score: score === null ? null : clampScore(score),
      feedback: asString(found.feedback).trim(),
      evidence,
      riskFlags,
      evidenceStatus: evidence.length > 0 ? ("matched" as const) : ("missing" as const),
    };
  });
}

export type AnalyticsValidationResult =
  | { ok: true; analytics: Analytics; warnings: string[] }
  | { ok: false; code: AnalysisFailureCode; message: string };

/**
 * 校验并归一化模型返回的评分结果。
 *
 * 关键取舍：
 *   - `overallScore` 缺失/非法 ⇒ 判为**评分失败**（明确报错让 HR 重新评分），
 *     而不是静默显示一个"暂无评分"的空壳；
 *   - 旧字段（overallFeedback / communication / questionSummaries / softSkillSummary）继续透传，
 *     保证历史结果页读取逻辑不受影响。
 */
export function normalizeAnalyticsResult(
  raw: unknown,
  options: { dimensions: CompetencyDimension[]; transcriptObject?: TranscriptTurn[] | null },
): AnalyticsValidationResult {
  if (!isRecord(raw)) {
    return {
      ok: false,
      code: "invalid_structure",
      message: "模型返回的内容不是 JSON 对象，无法解析为结构化评分结果。",
    };
  }

  const overallScore = toFiniteNumber(raw.overallScore);
  if (overallScore === null) {
    return {
      ok: false,
      code: "invalid_structure",
      message: "模型返回的评分缺少总体评分（overallScore），已判定为评分失败。",
    };
  }

  const warnings: string[] = [];

  const communication = isRecord(raw.communication)
    ? {
        score: toFiniteNumber(raw.communication.score) ?? 0,
        feedback: asString(raw.communication.feedback).trim(),
      }
    : null;
  if (!communication) {
    warnings.push("模型没有返回沟通表达能力评分。");
  }

  const questionSummaries = Array.isArray(raw.questionSummaries)
    ? raw.questionSummaries
        .filter(isRecord)
        .map((item) => ({ question: asString(item.question), summary: asString(item.summary) }))
        .filter((item) => item.question || item.summary)
    : [];
  if (questionSummaries.length === 0) {
    warnings.push("模型没有返回逐题小结。");
  }

  const competencyScores = buildCompetencyScores(
    raw.competencyScores,
    options.dimensions,
    options.transcriptObject ?? null,
    warnings,
  );
  const missingEvidence = competencyScores.filter((item) => item.evidenceStatus === "missing");
  if (missingEvidence.length > 0) {
    warnings.push(
      `以下维度没有可核验的候选人原话：${missingEvidence.map((item) => item.name).join("、")}`,
    );
  }

  const analytics = {
    overallScore: clampScore(overallScore),
    overallFeedback: asString(raw.overallFeedback).trim(),
    ...(communication ? { communication } : {}),
    generalIntelligence: asString(raw.generalIntelligence).trim(),
    softSkillSummary: asString(raw.softSkillSummary).trim(),
    questionSummaries,
    competencyScores,
    competencyDimensionNames: options.dimensions.map((dimension) => dimension.name),
  } as Analytics;

  return { ok: true, analytics, warnings };
}

/** 判断一份已落库的 analytics 是否包含 P1 的结构化能力证据。 */
export function hasStructuredCompetencyScores(analytics: unknown): boolean {
  if (!isRecord(analytics)) {
    return false;
  }
  const scores = analytics.competencyScores;

  return (
    Array.isArray(scores) &&
    scores.some(
      (item) => isRecord(item) && typeof item.name === "string" && item.name.trim() !== "",
    )
  );
}

/* ------------------------------------------------------------------ */
/* 二、评分任务：统一的领取 / 提交 / 失败（带任务标识的所有权校验）        */
/* ------------------------------------------------------------------ */

/**
 * 「评分中」超过这个时长就认为上一次任务没有正常收尾（进程退出、`after()` 回调丢失等），
 * 允许新的 worker 接管，避免 HR 遇到卡死的记录后永远点不动「重新评分」。
 */
export const ANALYSIS_TASK_STALE_MS = 3 * 60 * 1000;

/**
 * 任务标识存放位置：`details.diagnostics.analysis_task`。
 * 不新增数据库列——`db.ts` / `schema.sqlite.sql` 属 P0 冻结文件，而 `details` 本来就是 JSON 透传列。
 */
const ANALYSIS_TASK_FIELD = "analysis_task";

/** 一次评分任务的领取凭证。 */
export type AnalysisTaskClaim = {
  /** 唯一任务标识：只有持有它的 worker 才能把结果（或失败）提交回去 */
  taskId: string;
  /** 租约开始时间，同时写进 `analysis_started_at` 供超时计算 */
  startedAt: string;
};

/**
 * 生成任务标识。
 *
 * 刻意不用「毫秒时间戳」当 worker 身份：两个 worker 在同一毫秒领取时会拿到同一个标识，
 * 之后就无法区分「我的任务」和「接管者的任务」，迟到的旧任务会覆盖新结果。
 */
function newTaskId(): string {
  return randomUUID();
}

/** 复制对象并丢掉指定键（不用 `delete` 操作符：biome 的 noDelete 规则会告警）。 */
function omitKeys(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!keys.includes(key)) {
      next[key] = source[key];
    }
  }

  return next;
}

/**
 * 基于既有 details 生成一份新的 details：
 *   - `task` 非空 → 写入任务标识（本次领取）；
 *   - `task` 为 null → 清掉任务标识（本次任务已经提交或失败，租约结束）；
 *   - `removeError` → 顺便清掉上一次的失败原因，避免成功后还挂着旧的失败提示。
 */
function buildDetails(
  details: unknown,
  task: { id: string; started_at: string } | null,
  removeError: boolean,
): Record<string, unknown> {
  const base: Record<string, unknown> = isRecord(details) ? { ...details } : {};
  let diagnostics: Record<string, unknown> = isRecord(base.diagnostics)
    ? { ...base.diagnostics }
    : {};

  if (removeError) {
    diagnostics = omitKeys(diagnostics, ["analysis_error"]);
  }
  if (task) {
    diagnostics[ANALYSIS_TASK_FIELD] = task;
  } else {
    diagnostics = omitKeys(diagnostics, [ANALYSIS_TASK_FIELD]);
  }
  base.diagnostics = diagnostics;

  return base;
}

/** 读回当前任务标识（所有权校验用，也便于排障时看清这条记录归谁）。 */
export function readAnalysisTaskId(details: unknown): string | null {
  if (!isRecord(details)) {
    return null;
  }
  const diagnostics = details.diagnostics;
  if (!isRecord(diagnostics)) {
    return null;
  }
  const task = diagnostics[ANALYSIS_TASK_FIELD];
  if (!isRecord(task) || typeof task.id !== "string" || task.id.trim() === "") {
    return null;
  }

  return task.id.trim();
}

/**
 * processing 的租约是否已经过期。
 *
 * `analysis_started_at` 缺失或不可解析时**按过期处理**：否则一行坏数据就能把这条记录永久锁死，
 * HR 既等不到结果也点不动「重新评分」。
 */
export function isAnalysisLeaseExpired(
  startedAt: unknown,
  staleMs: number = ANALYSIS_TASK_STALE_MS,
): boolean {
  const parsed = Date.parse(asString(startedAt));

  return !Number.isFinite(parsed) || Date.now() - parsed >= Math.max(0, staleMs);
}

/**
 * 原子领取一次评分任务 —— **初次评分、人工重新评分、接管超时任务都走这一个入口**。
 *
 * 之前初次评分走 P0 的 boolean `claimAnalysis`（只认 `is_analysed = 0`，既没有任务标识可校验，
 * 也无法接管卡死的 processing），重新评分走另一条路径，两条路各自为政；
 * 现在统一成一套：领取即写入唯一任务标识，提交/失败都要拿这个标识做所有权校验。
 *
 * 只有满足「当前没有存活任务」才可能领取成功：
 *   idle / failed / completed 都可以领（重新评分就是在 completed 上再评一次），
 *   processing 则必须租约已过期（卡死接管）；租约内的 processing 直接拒绝，不重复计费。
 *
 * 整个「读 → 判断 → 写」在 IMMEDIATE 事务里完成，并且 UPDATE 里用 `json_extract` 再比一次
 * 领取前的状态、开始时间与旧任务标识（比较并交换）：即使并发请求同时进来，
 * 也只有一个能把 `changes` 拿到 1，不会出现两个 worker 同时调用模型或共用同一个任务标识。
 */
export async function claimAnalysisTask(
  callId: string,
  options: { staleMs?: number } = {},
): Promise<AnalysisTaskClaim | null> {
  const db = getDb();
  const staleMs = options.staleMs ?? ANALYSIS_TASK_STALE_MS;

  const claim = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT analysis_status, analysis_started_at, details
           FROM response WHERE call_id = ? AND is_ended = 1 LIMIT 1`,
      )
      .get(callId) as
      | {
          analysis_status?: string | null;
          analysis_started_at?: string | null;
          details?: string | null;
        }
      | undefined;
    if (!row) {
      return null;
    }

    // 逻辑判断用归一化后的状态，SQL 比对用原始值（NULL 与 'idle' 必须区分，否则 `IS` 比不中）。
    const rawStatus = row.analysis_status ?? null;
    const status = asString(rawStatus) || "idle";
    const startedAt = row.analysis_started_at ?? null;
    const details = fromJsonCol<unknown>(row.details ?? null, null);
    const previousTaskId = readAnalysisTaskId(details);

    // 已有存活任务在跑：不重复领取，让前端继续轮询。
    if (status === "processing" && !isAnalysisLeaseExpired(startedAt, staleMs)) {
      return null;
    }

    const startedAtIso = new Date().toISOString();
    const taskId = newTaskId();
    const nextDetails = buildDetails(details, { id: taskId, started_at: startedAtIso }, false);

    const result = db
      .prepare(
        `UPDATE response
            SET analysis_status = 'processing', analysis_started_at = ?, details = ?
          WHERE call_id = ? AND is_ended = 1
            AND analysis_status IS ?
            AND analysis_started_at IS ?
            AND json_extract(details, '$.diagnostics.analysis_task.id') IS ?`,
      )
      .run(startedAtIso, toJsonCol(nextDetails), callId, rawStatus, startedAt, previousTaskId);

    return result.changes === 1 ? { taskId, startedAt: startedAtIso } : null;
  });

  return claim.immediate();
}

function readDetailsRow(callId: string): { details: unknown; analytics: unknown } | null {
  const row = getDb()
    .prepare("SELECT details, analytics FROM response WHERE call_id = ? LIMIT 1")
    .get(callId) as { details: string | null; analytics: string | null } | undefined;
  if (!row) {
    return null;
  }

  return {
    details: fromJsonCol<unknown>(row.details, null),
    analytics: fromJsonCol<unknown>(row.analytics, null),
  };
}

/** 「能不能给 HR 看」的判定：必须有综合评分，空对象或半截 JSON 不算。 */
function hasUsableAnalytics(analytics: unknown): boolean {
  return isRecord(analytics) && toFiniteNumber(analytics.overallScore) !== null;
}

/**
 * 读一份可以展示的历史评分。
 *
 * 结果接口在 processing / failed / 未配置密钥时也要把它带上：重新评分期间，
 * 页面上原来那份结果不能凭空消失（数据一直在库里，之前是服务端返回了 null 把它盖掉了）。
 * 从来没有成功过就返回 null，绝不给出伪造分数。
 */
export function readUsableAnalytics(analytics: unknown): Analytics | null {
  return hasUsableAnalytics(analytics) ? (analytics as unknown as Analytics) : null;
}

/**
 * 标记一次评分失败，并把可操作的中文原因写进 `details.diagnostics.analysis_error`。
 *
 * ⚠️ 两个关键行为：
 *   1. **失败时保留上一份已经成功的评分**（重新评分场景）：只有从来没有成功过才把 `is_analysed`
 *      退回 0。这样 HR 不会因为一次重试失败就丢掉可用结果。
 *   2. **必须仍然持有任务才写得进去**：状态还得是 processing，且 `details` 里的任务标识还是自己。
 *      任务已被接管（超时接管或人工重评）时，迟到的旧任务在这里直接 no-op，
 *      不会把新任务标成失败、也不会动新任务的结果或任务标识。
 *
 * 返回 true 表示这次失败记录确实落库了；false 表示所有权已经转移（调用方只记日志即可）。
 */
export async function markAnalysisFailed(
  callId: string,
  taskId: string,
  failure: { code: AnalysisFailureCode | string; message: string },
): Promise<boolean> {
  const db = getDb();

  const apply = db.transaction(() => {
    const current = readDetailsRow(callId);
    if (!current) {
      return false;
    }

    // 所有权校验：任务标识不是我的，说明任务已被接管，绝不写。
    if (readAnalysisTaskId(current.details) !== taskId) {
      return false;
    }

    const details = buildDetails(current.details, null, false);
    const diagnostics: Record<string, unknown> = isRecord(details.diagnostics)
      ? details.diagnostics
      : {};
    diagnostics.analysis_error = {
      code: failure.code,
      message: failure.message,
      at: new Date().toISOString(),
    };
    details.diagnostics = diagnostics;

    const keepPrevious = hasUsableAnalytics(current.analytics);

    // 状态与任务标识一起写进 WHERE：写之前再确认一次「这条记录仍然是 processing 且仍然归我」。
    const result = db
      .prepare(
        `UPDATE response
            SET details = ?, analysis_status = 'failed', analysis_started_at = NULL,
                is_analysed = CASE WHEN ? = 1 THEN 1 ELSE 0 END
          WHERE call_id = ? AND analysis_status = 'processing'
            AND json_extract(details, '$.diagnostics.analysis_task.id') = ?`,
      )
      .run(toJsonCol(details), keepPrevious ? 1 : 0, callId, taskId);

    return result.changes === 1;
  });

  return apply.immediate();
}

/**
 * 提交一次成功的评分。
 *
 * 列语义与 P0 的 `completeAnalysis` 完全一致（analytics / is_analysed / analysis_status /
 * analysis_started_at / duration），只是多了**所有权校验**，并把「清掉上一次的失败原因、
 * 交还任务标识」放进同一个事务 —— 不留「已完成但仍挂着旧失败原因」的中间态。
 *
 * 任务已被接管时返回 false（调用方只记日志），绝不覆盖接管者写下的新结果。
 */
export async function completeAnalysisTask(
  callId: string,
  taskId: string,
  analytics: unknown,
): Promise<boolean> {
  const db = getDb();

  const commit = db.transaction(() => {
    const current = readDetailsRow(callId);
    if (!current) {
      return false;
    }

    if (readAnalysisTaskId(current.details) !== taskId) {
      return false;
    }

    const details = buildDetails(current.details, null, true);

    const result = db
      .prepare(
        `UPDATE response
            SET analytics = ?, is_analysed = 1, analysis_status = 'completed',
                analysis_started_at = NULL, duration = COALESCE(server_duration, duration),
                details = ?
          WHERE call_id = ? AND analysis_status = 'processing'
            AND json_extract(details, '$.diagnostics.analysis_task.id') = ?`,
      )
      .run(toJsonCol(analytics), toJsonCol(details), callId, taskId);

    return result.changes === 1;
  });

  return commit.immediate();
}

/** 从结果的 details 里读回评分失败原因（供结果接口下发到界面）。 */
export function readAnalysisError(details: unknown): AnalysisErrorInfo | null {
  if (!isRecord(details)) {
    return null;
  }
  const diagnostics = details.diagnostics;
  if (!isRecord(diagnostics)) {
    return null;
  }
  const error = diagnostics.analysis_error;
  if (!isRecord(error) || typeof error.message !== "string" || !error.message.trim()) {
    return null;
  }

  return {
    code: (typeof error.code === "string" ? error.code : "unknown") as AnalysisFailureCode,
    message: error.message.trim(),
    at: typeof error.at === "string" ? error.at : undefined,
  };
}

/** 结果接口用的中文可操作提示由 `@/types/response` 统一提供（服务端与客户端共用同一份文案）。 */
export { describeAnalysisFailure } from "@/types/response";

/* ------------------------------------------------------------------ */
/* 三、导出：真实数据 → 带 BOM 的 CSV                                   */
/* ------------------------------------------------------------------ */

export type InterviewExportRow = {
  callId: string;
  candidateName: string;
  email: string;
  overallScore: number | null;
  communicationScore: number | null;
  /** 维度名 → 分数；维度名与表头一致 */
  competencyScores: Record<string, number | null>;
  candidateStatusLabel: string;
  linkStatusLabel: string;
  durationSeconds: number | null;
  endReasonLabel: string;
};

const CANDIDATE_STATUS_TEXT: Record<string, string> = {
  NO_STATUS: "待筛选",
  NOT_SELECTED: "未选中",
  POTENTIAL: "潜力人选",
  SELECTED: "已选中",
};

const LINK_STATUS_TEXT: Record<string, string> = {
  ready: "未使用",
  in_progress: "面试中",
  completed: "已完成",
  revoked: "已撤销",
};

/** CSV 里以这些字符开头会被办公软件当公式执行，必须前置单引号。 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** 单元格转义：公式注入前缀 + 引号包裹 + 双引号转义。 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/** 组装岗位导出数据（只读）。**不包含**简历全文、提示词、密钥、专属 token。 */
export async function buildInterviewExportRows(interviewId: string): Promise<{
  rows: InterviewExportRow[];
  dimensions: CompetencyDimension[];
  interviewName: string;
}> {
  const interview = await getInterviewById(interviewId);
  if (!interview) {
    throw new Error("岗位不存在或已被删除，无法导出。");
  }

  const [responses, invites] = await Promise.all([
    getAllResponses(interviewId),
    getCandidateInvitesForInterview(interviewId),
  ]);
  const inviteById = new Map(invites.map((invite) => [invite.id, invite]));
  const dimensions = resolveCompetencyDimensions(interview.competency_dimensions);

  const rows = responses.map((response) => {
    const analytics = isRecord(response.analytics)
      ? (response.analytics as unknown as Analytics)
      : null;
    const details = isRecord(response.details) ? (response.details as unknown as CallData) : null;
    const invite = response.candidate_id ? inviteById.get(response.candidate_id) : undefined;

    const competencyScores: Record<string, number | null> = {};
    for (const dimension of dimensions) {
      const found = analytics?.competencyScores?.find((item) => item.name === dimension.name);
      competencyScores[dimension.name] = toFiniteNumber(found?.score);
    }

    return {
      callId: response.call_id ?? "",
      candidateName: (response.name || invite?.name || "匿名候选人").trim(),
      email: (response.email || invite?.email || "").trim(),
      overallScore: toFiniteNumber(analytics?.overallScore),
      communicationScore: toFiniteNumber(analytics?.communication?.score),
      competencyScores,
      candidateStatusLabel: CANDIDATE_STATUS_TEXT[response.candidate_status ?? ""] ?? "待筛选",
      linkStatusLabel: response.candidate_id
        ? invite
          ? (LINK_STATUS_TEXT[invite.status] ?? "")
          : "候选人记录缺失"
        : "历史记录",
      durationSeconds:
        response.server_duration ?? response.duration ?? toFiniteNumber(details?.duration),
      endReasonLabel: CALL_END_REASON_TEXT[details?.end_reason ?? ""] ?? "未知",
    } satisfies InterviewExportRow;
  });

  return { rows, dimensions, interviewName: interview.name || "未命名岗位" };
}

/** 带 UTF-8 BOM 与中文表头的 CSV 正文。 */
export function buildInterviewCsv(
  rows: InterviewExportRow[],
  dimensions: CompetencyDimension[],
): string {
  const headers = [
    "候选人姓名",
    "邮箱",
    "综合评分",
    "沟通表达分（0-10）",
    ...dimensions.map((dimension) => dimension.name),
    "候选人状态",
    "面试链接状态",
    "面试时长（秒）",
    "结束原因",
  ];

  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.candidateName,
        row.email,
        row.overallScore,
        row.communicationScore,
        ...dimensions.map((dimension) => row.competencyScores[dimension.name] ?? null),
        row.candidateStatusLabel,
        row.linkStatusLabel,
        row.durationSeconds,
        row.endReasonLabel,
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  }

  // BOM 必须放在最前面，否则 Excel 打开会乱码。
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
