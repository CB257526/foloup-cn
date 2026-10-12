import { logger } from "@/lib/logger";
import { generateInterviewAnalytics } from "@/services/analytics.service";
import { ResponseService } from "@/services/responses.service";
import type { CallData } from "@/types/response";
import { NextResponse, after } from "next/server";

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

  const callDetails = await ResponseService.getResponseByCallId(body.id);
  if (!callDetails) {
    return NextResponse.json({ error: "未找到该面试记录" }, { status: 404 });
  }

  const callResponse = toCallData(callDetails);

  if (callDetails.is_analysed && callDetails.analysis_status !== "processing") {
    return NextResponse.json({ callResponse, analytics: callDetails.analytics }, { status: 200 });
  }

  if (!callDetails.is_ended) {
    return NextResponse.json({ error: "面试尚未完成" }, { status: 409 });
  }

  // SQLite 原子领取保证并发的两个请求只有一个会进入模型调用。
  const claimed = await ResponseService.claimAnalysis(body.id);
  if (!claimed) {
    const latest = await ResponseService.getResponseByCallId(body.id);
    if (latest?.is_analysed) {
      return NextResponse.json(
        { callResponse: toCallData(latest), analytics: latest.analytics },
        { status: 200 },
      );
    }

    return NextResponse.json(
      { callResponse, analytics: null, analysis_status: "processing" },
      { status: 202 },
    );
  }

  // 逐字稿：优先用 P1 写入的 transcript 列，兼容 details 里的那一份。
  const transcript = callDetails.transcript || callResponse?.transcript || "";

  // 先把已落库的服务端时长、结束原因和逐字稿返回给结果页，再用 Next 的 after
  // 在响应发出后继续评分。这样评分慢或失败时，HR 仍能立即看到面试过程结果。
  after(async () => {
    try {
      const result = await generateInterviewAnalytics({
        callId: body.id,
        interviewId: callDetails.interview_id,
        transcript,
      });

      if (result.status !== 200 || !result.analytics) {
        await ResponseService.releaseAnalysis(body.id);
        logger.error("Call analysis failed", result.error ?? "评分服务未返回结果");
        return;
      }

      await ResponseService.completeAnalysis(body.id, result.analytics);
      logger.info("Call analysed successfully");
    } catch (error) {
      await ResponseService.releaseAnalysis(body.id);
      logger.error("Call analysis failed", error instanceof Error ? error.message : String(error));
    }
  });

  return NextResponse.json(
    { callResponse, analytics: null, analysis_status: "processing" },
    { status: 202 },
  );
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
