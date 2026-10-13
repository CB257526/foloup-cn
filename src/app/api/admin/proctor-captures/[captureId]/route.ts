import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { getAdminSession } from "@/lib/auth/admin";
import { getCapturePath } from "@/lib/data/proctoring";

export async function GET(
  _request: Request,
  context: { params: Promise<{ captureId: string }> },
) {
  const admin = await getAdminSession();
  if (!admin || admin.mustChangePassword) {
    return NextResponse.json({ error: "需要管理员登录。" }, { status: 401 });
  }
  const { captureId } = await context.params;
  const id = Number(captureId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "截图编号无效。" }, { status: 400 });
  }
  const capture = getCapturePath(id);
  if (!capture) return NextResponse.json({ error: "截图不存在或已过期。" }, { status: 404 });
  return new NextResponse(await fs.readFile(capture.path), {
    status: 200,
    headers: {
      "Content-Type": capture.mime,
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
