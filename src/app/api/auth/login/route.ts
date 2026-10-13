import { NextResponse } from "next/server";
import {
  adminCookieName,
  adminSessionDays,
  createAdminSession,
  ensureInitialAdmin,
  verifyAdminCredentials,
} from "@/lib/auth/admin";

const attempts = new Map<string, { count: number; resetAt: number }>();

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const originUrl = new URL(origin);
    return originUrl.host === host && (originUrl.protocol === "http:" || originUrl.protocol === "https:");
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "请求来源校验失败。" }, { status: 403 });
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const current = attempts.get(forwarded);
  if (current && current.resetAt > now && current.count >= 10) {
    return NextResponse.json({ error: "登录尝试过于频繁，请稍后重试。" }, { status: 429 });
  }
  if (!current || current.resetAt <= now) {
    attempts.set(forwarded, { count: 0, resetAt: now + 5 * 60 * 1000 });
  }

  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password || username.length > 80 || password.length > 128) {
      attempts.get(forwarded)!.count++;
      return NextResponse.json({ error: "账号或密码不正确。" }, { status: 401 });
    }

    await ensureInitialAdmin();
    const admin = await verifyAdminCredentials(username, password);
    if (!admin) {
      attempts.get(forwarded)!.count++;
      return NextResponse.json({ error: "账号或密码不正确。" }, { status: 401 });
    }

    attempts.delete(forwarded);
    const token = createAdminSession(admin.id);
    const response = NextResponse.json({
      success: true,
      mustChangePassword: admin.mustChangePassword,
    });
    response.cookies.set(adminCookieName(), token, {
      httpOnly: true,
      secure: new URL(request.url).protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: adminSessionDays() * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    console.error("管理员登录失败：", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "登录服务暂时不可用，请稍后重试。" }, { status: 500 });
  }
}
