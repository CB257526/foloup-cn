"use client";

import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("admin");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "修改密码失败");
      router.replace("/dashboard");
      router.refresh();
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "修改密码失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">修改管理员密码</h1>
            <p className="mt-1 text-sm text-slate-500">首次登录必须完成这一步</p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">当前密码</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">新密码</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">确认新密码</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button className="h-11 w-full bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
            {loading && <Loader2 className="mr-2 animate-spin" size={16} />}
            保存新密码
          </Button>
        </form>
      </section>
    </main>
  );
}
