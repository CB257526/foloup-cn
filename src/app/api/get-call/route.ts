import {
  claimAnalysisTask,
  completeAnalysisTask,
  isAnalysisLeaseExpired,
  markAnalysisFailed,
  readAnalysisError,
  readUsableAnalytics,
} from "@/lib/data/analytics";
import { getLlmConfig } from "@/lib/llm";
import { logger } from "@/lib/logger";
import { generateInterviewAnalytics } from "@/services/analytics.service";
import { ResponseService } from "@/services/responses.service";
import type { AnalysisErrorInfo, AnalysisStatus, CallData } from "@/types/response";
import { describeAnalysisFailure } from "@/types/response";
import { NextResponse, after } from "next/server";

/**
 * 读取一次面试的结果：过程数据（逐字稿 / 时长 / 结束原因）+ AI 评分。
 *
 * 评分策略（沿用 P0「先返回过程数据，再用 after() 异步评分」的设计）：
 *   - 已经评成功（completed）→ 直接返回，不重复调模型；
 *   - 评分失败（failed）→ **不自动重试**，返回中文失败原因，等 HR 显式点「重新评分」；
 *       （自动重试会导致每次打开页面都白烧一次 token）
 *   - 没有配置模型密钥 → 直接给出「未配置密钥」状态，不领取也不调模型；
 *   - 从没评过（idle）、租约已过期的 processing、以及请求体带 `retry: true` 的人工重评
 *       → 全部走同一个带任务标识的原子领取 `claimAnalysisTask`。
 *
 * ⚠️ 两条必须守住的行为（P1 验收发现的阻塞问题）：
 *   1. **有旧评分时不能返回 null**：重新评分期间（processing）或本次重评失败时，
 *      都要把上一次成功的 analytics 一起返回。数据一直在库里，界面不该让 HR 以为结果丢了。
 *      从来没有成功过才返回 null，不显示伪造分数。
 *   2. **迟到的旧任务不能覆盖新任务**：领取时写入唯一任务标识，提交/失败都校验所有权
 *      （见 `@/lib/data/analytics`），所以超时接管后旧 worker 的结果会被安全丢弃。
 *
 * 🚫 缓存：SQLite 读取本身就是实时查询，这里再显式声明 `Cache-Control: no-store`，
 *    确保 HR 点「重新评分」后拿到的一定是新结果，而不是浏览器/中间层缓存的旧评分。
 *
 * 请求体：{ id: call_id, retry?: boolean }
 * 响应体：{ callResponse, analytics, analysis_status, analysis_error? }
 */
export async function POST(req: Request) {
  logger.info("get-call request received");

  const body = await req.json().catch(() => null);
  const callId = typeof body?.id === "string" ? body.id.trim() : "";
  const isRetry = body?.retry === true;

  if (!callId) {
    return json({ error: "缺少 call_id" }, 400);
  }

  const callDetails = await ResponseService.getResponseByCallId(callId);
  if (!callDetails?.call_id) {
    return json({ error: "未找到该面试记录" }, 404);
  }

  const callResponse = toCallData(callDetails);
  const analysisStatus = normalizeStatus(callDetails.analysis_status);
  const analysisError = readAnalysisError(callDetails.details);
  // 上一次成功的评分：processing / failed / 未配置密钥时都要一并下发，不能因为「本次还没结果」就把它抹掉。
  const previousAnalytics = readUsableAnalytics(callDetails.analytics);

  // 已有可用评分、且当前不在评分中 → 直接回读（failed 状态也带上旧评分，界面自行提示）。
  if (!isRetry && callDetails.is_analysed && analysisStatus !== "processing") {
    return json(
      {
        callResponse,
        analytics: previousAnalytics,
        analysis_status: analysisStatus,
        analysis_error: analysisError,
      },
      200,
    );
  }

  if (!callDetails.is_ended) {
    return json({ error: "面试尚未完成" }, 409);
  }

  // 没有配置密钥时既不领取也不调用模型，直接给出可操作的中文状态。
  if (!hasLlmApiKey()) {
    const hint = describeAnalysisFailure({ code: "no_api_key", message: "" });

    return json(
      {
        callResponse,
        analytics: previousAnalytics,
        analysis_status: "no_api_key" satisfies AnalysisStatus,
        analysis_error: { code: "no_api_key", message: hint } satisfies AnalysisErrorInfo,
      },
      200,
    );
  }

  if (!isRetry) {
    if (analysisStatus === "failed") {
      // 失败后不再自动调模型，等 HR 主动点「重新评分」。
      return json(
        {
          callResponse,
          analytics: previousAnalytics,
          analysis_status: "failed",
          analysis_error: analysisError,
        },
        200,
      );
    }

    if (
      analysisStatus === "processing" &&
      !isAnalysisLeaseExpired(callDetails.analysis_started_at)
    ) {
      // 有存活任务在跑：不重复领取，让前端轮询（同时把上次成功的评分带上）。
      return json(
        { callResponse, analytics: previousAnalytics, analysis_status: "processing" },
        202,
      );
    }
    // 走到这里只剩两种情况：从没评过（idle），或 processing 的租约已过期（上一次没正常收尾）——
    // 后者由下面的统一领取接管，否则这条记录会永远卡在「评分中」。
  }

  const claim = await claimAnalysisTask(callId);
  if (!claim) {
    // 并发请求刚刚抢到（或租约仍在有效期内）：不重复调用模型，让前端轮询。
    return json({ callResponse, analytics: previousAnalytics, analysis_status: "processing" }, 202);
  }

  scheduleScoring({
    callId,
    taskId: claim.taskId,
    interviewId: callDetails.interview_id ?? "",
    transcript: callDetails.transcript || callResponse?.transcript || "",
  });

  return json({ callResponse, analytics: previousAnalytics, analysis_status: "processing" }, 202);
}

/**
 * 用 Next 的 `after` 在响应发出后继续评分：评分慢或失败时，HR 仍能立即看到面试过程结果。
 *
 * 提交与失败都带上本次领取的任务标识（`taskId`）：
 *   - 任务已经被接管（超时接管 / 人工重评）时，所有权校验会失败，这里只记日志，
 *     **绝不覆盖接管者的结果，也不会把新任务标成失败**；
 *   - 失败时不删除已有评分——`markAnalysisFailed` 会保留上一份成功结果，只记录失败原因。
 */
function scheduleScoring(input: {
  callId: string;
  taskId: string;
  interviewId: string;
  transcript: string;
}) {
  after(async () => {
    try {
      const result = await generateInterviewAnalytics({
        callId: input.callId,
        interviewId: input.interviewId,
        transcript: input.transcript,
      });

      if (result.status !== 200 || !result.analytics) {
        await failTask(input.callId, input.taskId, {
          code: result.code ?? "unknown",
          message: result.message ?? "评分服务没有返回结果",
        });

        return;
      }

      // 成功提交：同一个事务里写入新评分、清掉上一次的失败原因并交还任务标识。
      const committed = await completeAnalysisTask(input.callId, input.taskId, result.analytics);
      if (committed) {
        logger.info("Call analysed successfully");
      } else {
        logger.warn("评分任务所有权已转移，丢弃这次迟到的评分结果");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failTask(input.callId, input.taskId, { code: "unknown", message });
    }
  });
}

/** 记录失败；所有权已经转移时只记日志（旧任务不得改动新任务的状态）。 */
async function failTask(
  callId: string,
  taskId: string,
  failure: { code: string; message: string },
) {
  const recorded = await markAnalysisFailed(callId, taskId, failure);
  if (recorded) {
    logger.error("Call analysis failed", failure.message);
  } else {
    logger.warn("评分任务所有权已转移，忽略这次迟到的失败结果", failure.message);
  }
}

function hasLlmApiKey(): boolean {
  try {
    return Boolean(getLlmConfig().apiKey);
  } catch (error) {
    logger.error("读取模型配置失败", error instanceof Error ? error.message : String(error));

    return false;
  }
}

function normalizeStatus(value: unknown): AnalysisStatus {
  return value === "processing" || value === "completed" || value === "failed" || value === "idle"
    ? value
    : "idle";
}

/** 所有响应都禁用缓存，保证"重新评分"后立即读到新结果。 */
function json(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

/**
 * 结果页只信任 response 表的服务端字段。
 * 历史记录没有 started_at / ended_at / server_duration 时，保留 details 旧值并返回 null，
 * 让旧记录继续可读，而不会因为字段缺失直接渲染崩溃。
 */
function toCallData(response: Awaited<ReturnType<typeof ResponseService.getResponseByCallId>>) {
  const details = (response?.details ?? null) as CallData | null;
  if (!details) {
    return null;
  }

  const serverDuration = response.server_duration ?? response.duration ?? details.duration ?? 0;

  return {
    ...details,
    duration: serverDuration,
    server_duration: response.server_duration,
    started_at: response.started_at ?? details.started_at ?? null,
    ended_at: response.ended_at ?? details.ended_at ?? null,
  } satisfies CallData;
}
