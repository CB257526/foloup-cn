import type { Metadata } from "next";
import "../globals.css";
import { requireAdmin } from "@/lib/auth/admin";
import ClientShell from "./client-shell";

export const metadata: Metadata = {
  title: "FoloUp 管理后台",
  description: "FoloUp AI 智能面试管理后台",
};

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/browser-client-icon.ico" />
      </head>
      <ClientShell>{children}</ClientShell>
    </html>
  );
}
