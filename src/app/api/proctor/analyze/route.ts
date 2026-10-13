import { NextResponse } from "next/server";
import { chatCompletion, extractJson } from "@/lib/llm";
import {
  createPendingCapture,
  markProctorSuccess,
  recordCaptureAndAnalysis,
  recordProctorFailure,
} from "@/lib/data/proctoring";
import { PROCTOR_SYSTEM_PROMPT, PROCTOR_USER_PROMPT } from "@/lib/proctoring/prompt";
import type { ProctorAnalysis } from "@/lib/proctoring/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 2_900_000) {
      return NextResponse.json({ error: "截图请求超过大小限制。" }, { status: 413 });
    }
    const body = (await request.json()) as {
      callId?: unknown;
      token?: unknown;
      imageDataUrl?: unknown;
      transcript?: unknown;
    };
    if (
      typeof body.callId !== "string" ||
      typeof body.token !== "string" ||
      typeof body.imageDataUrl !== "string"
    ) {
      return NextResponse.json({ error: "监考请求参数不完整。" }, { status: 400 });
    }
    const pending = createPendingCapture({
      callId: body.callId,
      token: body.token,
      dataUrl: body.imageDataUrl,
    });

    try {
      const raw = await chatCompletion({
        system: PROCTOR_SYSTEM_PROMPT,
        user: PROCTOR_USER_PROMPT,
        json: false,
        maxTokens: 2000,
        retries: 0,
        imageDataUrl: pending.imageDataUrl,
      });
      const analysis = extractJson<ProctorAnalysis>(raw);
      const result = recordCaptureAndAnalysis({
        callId: body.callId,
        token: body.token,
        captureId: pending.captureId,
        analysis,
        transcript: validateTranscript(body.transcript),
      });
      markProctorSuccess(body.callId, body.token);
      return NextResponse.json(result);
    } catch (error) {
      const failures = recordProctorFailure(
        body.callId,
        body.token,
        pending.captureId,
        "vision_analysis_failed",
        error instanceof Error ? error.message : "视觉模型调用失败",
      );
      return NextResponse.json({
        captureId: pending.captureId,
        status: "error",
        strikeCount: 0,
        maxStrikes: 3,
        event: null,
        terminated: false,
        consecutiveFailures: failures,
      });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "摄像头监考分析失败。" },
      { status: 400 },
    );
  }
}

function validateTranscript(value: unknown): Array<{ role: "agent" | "user"; content: string; offset_ms: number }> {
  if (!Array.isArray(value) || value.length > 600) throw new Error("逐字稿快照格式无效。");
  return value.map((item) => {
    if (typeof item !== "object" || item === null) throw new Error("逐字稿快照格式无效。");
    const turn = item as Record<string, unknown>;
    if (
      (turn.role !== "agent" && turn.role !== "user") ||
      typeof turn.content !== "string" ||
      turn.content.length > 5000 ||
      typeof turn.offset_ms !== "number" ||
      !Number.isFinite(turn.offset_ms) ||
      turn.offset_ms < 0
    ) {
      throw new Error("逐字稿快照格式无效。");
    }
    return { role: turn.role, content: turn.content, offset_ms: turn.offset_ms };
  });
}
