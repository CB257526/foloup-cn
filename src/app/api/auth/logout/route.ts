import { NextResponse } from "next/server";
import { adminCookieName, revokeAdminSession } from "@/lib/auth/admin";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    return NextResponse.json({ error: "请求来源校验失败。" }, { status: 403 });
  }

  const jar = await cookies();
  const token = jar.get(adminCookieName())?.value || "";
  revokeAdminSession(token);
  const response = NextResponse.json({ success: true });
  response.cookies.set(adminCookieName(), "", {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
