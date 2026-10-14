"use client";

import type { Turn } from "@/components/call/realtimeClient";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * 面试实时对话面板。
 *
 * 面试过程中把**双方说过的每一句**按时间顺序列出来（AI 在左、候选人在右），
 * 新内容到达时自动滚到底部；如果用户自己往上翻，就暂时不再自动滚动，
 * 免得看到一半被拉走。
 *
 * 两种用法（同一个组件）：
 *   · 桌面端（xl 及以上）当作常驻侧栏，用 className 控制宽度与吸顶
 *   · 小屏当作抽屉内容，传 onClose 会多出一个关闭按钮
 */
type ConversationPanelProps = {
  turns: Turn[];
  /** 传入则显示关闭按钮（移动端抽屉用） */
  onClose?: () => void;
  className?: string;
};

export function ConversationPanel({ turns, onClose, className = "" }: ConversationPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 用户是否停在底部附近；停在底部才自动跟随新内容 */
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    if (turns.length === 0) {
      el.scrollTop = 0;
      return;
    }
    if (!stickToBottomRef.current) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  return (
    <aside
      className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,0.9)] ${className}`}
      aria-label="面试对话记录"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-bold leading-6 text-slate-900">对话记录</span>
          <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold leading-5 text-indigo-700">
            {turns.length} 句
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭对话记录"
            className="shrink-0 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        )}
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3"
      >
        {turns.length === 0 && (
          <p className="px-1 py-8 text-center text-sm font-normal leading-6 text-slate-400">
            面试开始后，这里会实时显示你和 AI 面试官的每一句对话。
          </p>
        )}

        {turns.map((turn, index) => {
          const isAgent = turn.role === "agent";
          return (
            // id 在个别情况下可能重复（服务端没下发 item_id 时会回落到固定串），
            // 所以把下标拼进 key，避免 React 复用错节点。
            <div
              key={`${turn.id}-${index}`}
              className={`flex flex-col ${isAgent ? "items-start" : "items-end"}`}
            >
              <span
                className={`mb-1 px-1 text-xs font-semibold leading-5 ${
                  isAgent ? "text-indigo-600" : "text-slate-500"
                }`}
              >
                {isAgent ? "AI 面试官" : "你"}
                {turn.live && <span className="ml-1 font-normal text-slate-400">正在说…</span>}
              </span>
              <div
                className={`max-w-[92%] whitespace-pre-wrap rounded-2xl border px-3 py-2 text-sm font-normal leading-6 [overflow-wrap:anywhere] ${
                  isAgent
                    ? "border-indigo-200 bg-indigo-50 text-slate-800"
                    : "border-slate-200 bg-slate-100 text-slate-800"
                } ${turn.live ? "opacity-60" : ""}`}
              >
                {turn.content || "…"}
              </div>
            </div>
          );
        })}
      </div>

      <p className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-normal leading-5 text-slate-400">
        仅显示本次会话的实时转写，仅供你回看。
      </p>
    </aside>
  );
}

export default ConversationPanel;
