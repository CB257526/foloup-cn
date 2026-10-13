"use client";

import { Button } from "@/components/ui/button";
import { Loader2, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await response.json()) as { error?: string; mustChangePassword?: boolean };
      if (!response.ok) throw new Error(data.error || "登录失败");
      router.replace(data.mustChangePassword ? "/change-password" : "/dashboard");
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  const [changePassword, setChangePassword] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setChangePassword(new URLSearchParams(window.location.search).get("changePassword") === "1");
    }
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-indigo-50 p-3 text-indigo-600">
            <LockKeyhole size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">管理员登录</h1>
            <p className="mt-1 text-sm text-slate-500">进入 FoloUp 管理后台</p>
          </div>
        </div>
        {changePassword && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            当前仍在使用初始密码，请登录后立即修改。
          </div>
        )}
        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">管理员账号</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">密码</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button className="h-11 w-full bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
            {loading && <Loader2 className="mr-2 animate-spin" size={16} />}
            登录后台
          </Button>
        </form>
        <p className="mt-5 text-xs leading-5 text-slate-500">
          初始账号为 admin，首次登录后必须修改密码。生产环境禁止长期使用默认密码。
        </p>
      </section>
    </main>
  );
}
