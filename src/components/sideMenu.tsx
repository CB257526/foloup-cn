"use client";

import { PlayCircleIcon, SettingsIcon, SpeechIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import React from "react";

function SideMenu() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="z-[10] bg-slate-100 p-3 md:p-6 w-[72px] md:w-[200px] fixed top-[64px] left-0 h-[calc(100vh-64px)]">
      <div className="flex flex-col gap-1">
        <div className="flex flex-col justify-between gap-2">
          <button
            type="button"
            aria-label="岗位"
            className={`flex flex-row items-center p-3 rounded-md hover:bg-slate-200 cursor-pointer ${
              pathname.endsWith("/dashboard") || pathname.includes("/interviews")
                ? "bg-indigo-200"
                : "bg-slate-100"
            }`}
            onClick={() => router.push("/dashboard")}
          >
            <PlayCircleIcon className="font-thin	 mr-2" />
            <p className="hidden md:block font-medium">岗位</p>
          </button>
          <button
            type="button"
            aria-label="面试官"
            className={`flex flex-row items-center p-3 rounded-md hover:bg-slate-200 cursor-pointer ${
              pathname.endsWith("/interviewers") ? "bg-indigo-200" : "bg-slate-100"
            }`}
            onClick={() => router.push("/dashboard/interviewers")}
          >
            <SpeechIcon className="font-thin mr-2" />
            <p className="hidden md:block font-medium">面试官</p>
          </button>
          <button
            type="button"
            aria-label="系统设置"
            className={`flex flex-row items-center p-3 rounded-md hover:bg-slate-200 cursor-pointer ${
              pathname.endsWith("/settings") ? "bg-indigo-200" : "bg-slate-100"
            }`}
            onClick={() => router.push("/settings")}
          >
            <SettingsIcon className="font-thin mr-2" />
            <p className="hidden md:block font-medium">系统设置</p>
          </button>
        </div>
      </div>
    </div>
  );
}

export default SideMenu;
