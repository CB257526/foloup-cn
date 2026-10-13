import { NextResponse } from "next/server";
import { getAppSettings } from "@/lib/data/settings";

export async function GET() {
  const settings = getAppSettings();
  return NextResponse.json({
    enabled: settings.proctoringEnabled,
    intervalSeconds: settings.proctoringIntervalSeconds,
  });
}
