import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/admin";

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, mustChangePassword: admin.mustChangePassword });
}
