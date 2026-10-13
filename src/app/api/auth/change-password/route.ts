import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { changeAdminPassword, adminCookieName, adminSessionDays, createAdminSession, getAdminSession } from "@/lib/auth/admin";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    return NextResponse.json({ error: "请求来源校验失败。" }, { status: 403 });
  }

  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "请先登录管理员账号。" }, { status: 401 });

  try {
    const body = (await request.json()) as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string") {
      return NextResponse.json({ error: "请填写当前密码和新密码。" }, { status: 400 });
    }
    await changeAdminPassword(admin.id, body.currentPassword, body.newPassword);

    const token = createAdminSession(admin.id);
    const response = NextResponse.json({ success: true });
    response.cookies.set(adminCookieName(), token, {
      httpOnly: true,
      secure: new URL(request.url).protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: adminSessionDays() * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "修改密码失败。" },
      { status: 400 },
    );
  }
}
