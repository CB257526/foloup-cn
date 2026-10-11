import { logger } from "@/lib/logger";
import { generateInterviewAnalytics } from "@/services/analytics.service";
import { ResponseService } from "@/services/responses.service";
import type { CallData } from "@/types/response";
import { NextResponse } from "next/server";

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

  const callDetails = await ResponseService.getResponseByCallId(body.id);
  if (!callDetails) {
    return NextResponse.json({ error: "未找到该面试记录" }, { status: 404 });
  }

  const callResponse = (callDetails.details ?? null) as CallData | null;

  if (callDetails.is_analysed) {
    return NextResponse.json(
      { callResponse, analytics: callDetails.analytics },
      { status: 200 },
    );
  }

  // 逐字稿：优先用 P1 写入的 transcript 列，兼容 details 里的那一份
  const transcript = callDetails.transcript || callResponse?.transcript || "";

  const result = await generateInterviewAnalytics({
    callId: body.id,
    interviewId: callDetails.interview_id,
    transcript,
  });

  const analytics = result.analytics;

  await ResponseService.saveResponse(
    {
      is_analysed: true,
      duration: callResponse?.duration ?? callDetails.duration ?? 0,
      analytics: analytics,
    },
    body.id,
  );

  logger.info("Call analysed successfully");

  return NextResponse.json({ callResponse, analytics }, { status: 200 });
}
