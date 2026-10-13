import { logger } from "@/lib/logger";
import { generateInterviewAnalytics } from "@/services/analytics.service";
import {
  claimAnalysis,
  completeAnalysis,
  getResponseByCallId,
  releaseAnalysis,
} from "@/lib/data/responses";
import type { ResponseRow } from "@/lib/data/responses";
import type { CallData } from "@/types/response";
import { NextResponse, after } from "next/server";
import { getAdminSession } from "@/lib/auth/admin";
import { verifyCandidateActionToken } from "@/lib/data/responses";
import { getProctorEvidence, getProctorSessionInfo } from "@/lib/data/proctoring";

/**
 * 读取一次面试的结果：逐字稿 + AI 评分。
 *
 * 原实现是拿 call_id 去 Retell 拉通话对象；现在逐字稿由浏览器在会话结束时
 * 直接落库（Server Action），这里只负责「没评分过就触发一次评分」。
 *
 * 请求体：{ id: call_id }
 * 响应体：{ callResponse: CallData | null, analytics: Analytics | null }
 */
export async function POST(req: Request) {
  logger.info("get-call request received");
  const body = await req.json();

  if (typeof body?.id !== "string" || !body.id) {
    return NextResponse.json({ error: "缺少 call_id" }, { status: 400 });
  }

  const admin = await getAdminSession();
  const isAdmin = Boolean(admin && !admin.mustChangePassword);
  if (!isAdmin && (typeof body?.token !== "string" || !verifyCandidateActionToken(body.id, body.token))) {
    return NextResponse.json({ error: "面试会话凭证无效。" }, { status: 401 });
  }

  const callDetails = await getResponseByCallId(body.id);
  if (!callDetails) {
    return NextResponse.json({ error: "未找到该面试记录" }, { status: 404 });
  }

  const callResponse = toCallData(callDetails);
  const enrichedCallResponse = isAdmin
    ? addProctoringEvidence(callResponse, body.id)
    : callResponse;

  if (callDetails.is_analysed && callDetails.analysis_status !== "processing") {
    return isAdmin
      ? NextResponse.json({ callResponse: enrichedCallResponse, analytics: callDetails.analytics }, { status: 200 })
      : NextResponse.json({ analysis_status: "completed" }, { status: 200 });
  }

  if (!callDetails.is_ended) {
    return NextResponse.json({ error: "面试尚未完成" }, { status: 409 });
  }

  // SQLite 原子领取保证并发的两个请求只有一个会进入模型调用。
  const claimed = await claimAnalysis(body.id);
  if (!claimed) {
    const latest = await getResponseByCallId(body.id);
    if (latest?.is_analysed) {
      return isAdmin
        ? NextResponse.json({ callResponse: addProctoringEvidence(toCallData(latest), body.id), analytics: latest.analytics }, { status: 200 })
        : NextResponse.json({ analysis_status: "completed" }, { status: 200 });
    }

    return isAdmin
      ? NextResponse.json({ callResponse, analytics: null, analysis_status: "processing" }, { status: 202 })
      : NextResponse.json({ analysis_status: "processing" }, { status: 202 });
  }

  // 逐字稿：优先用 P1 写入的 transcript 列，兼容 details 里的那一份。
  const transcript = callDetails.transcript || callResponse?.transcript || "";

  // 先把已落库的服务端时长、结束原因和逐字稿返回给结果页，再用 Next 的 after
  // 在响应发出后继续评分。这样评分慢或失败时，HR 仍能立即看到面试过程结果。
  after(async () => {
    try {
      const result = await generateInterviewAnalytics({
        callId: body.id,
        interviewId: callDetails.interview_id || "",
        transcript,
      });

      if (result.status !== 200 || !result.analytics) {
        await releaseAnalysis(body.id);
        logger.error("Call analysis failed", result.error ?? "评分服务未返回结果");
        return;
      }

      await completeAnalysis(body.id, result.analytics);
      logger.info("Call analysed successfully");
    } catch (error) {
      await releaseAnalysis(body.id);
      logger.error("Call analysis failed", error instanceof Error ? error.message : String(error));
    }
  });

  return isAdmin
    ? NextResponse.json({ callResponse: enrichedCallResponse, analytics: null, analysis_status: "processing" }, { status: 202 })
    : NextResponse.json({ analysis_status: "processing" }, { status: 202 });
}

function addProctoringEvidence(call: CallData | null, callId: string): CallData | null {
  if (!call) return null;
  const session = getProctorSessionInfo(callId);
  const evidence = getProctorEvidence(callId);
  if (!session && evidence.captures.length === 0) return call;
  return {
    ...call,
    proctoring: {
      enabled: session ? session.enabled === 1 : true,
      interval_seconds: session?.interval_seconds ?? 30,
      confidence_threshold: session?.confidence_threshold ?? 0.85,
      strike_count: evidence.events.length,
      terminated: call.end_reason === "proctoring_terminated",
      captures: evidence.captures as Array<Record<string, unknown>>,
      events: evidence.events as Array<Record<string, unknown>>,
      serviceEvents: evidence.serviceEvents as Array<Record<string, unknown>>,
    },
  };
}

/**
 * 结果页只信任 response 表的服务端字段。
 * 历史记录没有 started_at / ended_at / server_duration 时，保留 details 旧值并返回 null，
 * 让旧记录继续可读，而不会因为字段缺失直接渲染崩溃。
 */
function toCallData(response: ResponseRow | null) {
  const details = (response?.details ?? null) as CallData | null;
  if (!details || !response) {
    return null;
  }

  const serverDuration = response.server_duration ?? response.duration ?? details.duration ?? 0;

  return {
    ...details,
    duration: serverDuration,
    server_duration: response.server_duration,
    started_at: response.started_at ?? details.started_at ?? null,
    ended_at: response.ended_at ?? details.ended_at ?? null,
    end_reason: details.end_reason ?? "",
  } satisfies CallData;
}
