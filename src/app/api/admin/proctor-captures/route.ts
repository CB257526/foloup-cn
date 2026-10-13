import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/admin";
import { cleanupExpiredProctorCaptures, listProctorCaptures } from "@/lib/data/proctoring";

export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin || admin.mustChangePassword) {
    return NextResponse.json({ error: "需要管理员登录。" }, { status: 401 });
  }
  const callId = new URL(request.url).searchParams.get("callId") || "";
  if (!callId || callId.length > 160) {
    return NextResponse.json({ error: "缺少有效的面试会话编号。" }, { status: 400 });
  }
  cleanupExpiredProctorCaptures();
  return NextResponse.json({ captures: listProctorCaptures(callId) });
}
