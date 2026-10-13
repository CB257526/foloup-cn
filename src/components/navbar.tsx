"use client";

import { LogOut, Shield } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

function Navbar() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("退出登录失败，请稍后重试。");
      setLoggingOut(false);
    }
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[10] h-fit bg-slate-100 py-4">
      <div className="mx-auto flex h-full items-center justify-between gap-2 px-4 md:px-8">
        <Link href="/dashboard" className="flex items-center gap-2">
          <p className="px-2 py-1 text-xl font-bold text-black md:text-2xl">
            Folo<span className="text-indigo-600">Up</span>{" "}
            <span className="text-[8px]">测试版</span>
          </p>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/change-password"
            className="inline-flex items-center gap-1 rounded-md px-2 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200"
          >
            <Shield size={15} />
            修改密码
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={loggingOut}
            className="inline-flex items-center gap-1 rounded-md px-2 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50"
          >
            <LogOut size={15} />
            {loggingOut ? "退出中" : "退出登录"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Navbar;
