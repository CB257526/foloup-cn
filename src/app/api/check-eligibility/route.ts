import { NextResponse } from "next/server";
import { isCandidateEligibleForInterview } from "@/lib/data/responses";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { interviewId?: unknown; email?: unknown };
    if (typeof body.interviewId !== "string" || typeof body.email !== "string") {
      return NextResponse.json({ error: "缺少岗位或邮箱信息。" }, { status: 400 });
    }
    return NextResponse.json({ eligible: isCandidateEligibleForInterview(body.interviewId, body.email) });
  } catch {
    return NextResponse.json({ error: "无法校验面试资格。" }, { status: 400 });
  }
}
