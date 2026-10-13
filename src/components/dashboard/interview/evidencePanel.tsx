"use client";

import { Button } from "@/components/ui/button";
import type { CompetencyScore, TranscriptTurn } from "@/types/response";
import { ALERT_NOTE, normalizeTranscriptForMatch } from "@/types/response";
import { AlertTriangle, ChevronDown, ChevronRight, Quote, ShieldAlert } from "lucide-react";
import { useState } from "react";

interface Props {
  scores: CompetencyScore[];
  transcriptObject?: TranscriptTurn[] | null;
}

/** 毫秒偏移 → 「第 X 分 Y 秒」；没有偏移时由调用方显示「位置未知」。 */
function formatOffset(offsetMs: number): string {
  const totalSeconds = Math.max(0, Math.round(offsetMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `第 ${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
}

/**
 * 在结构化逐字稿里找回引文所在的那一轮，并连带展示前一拍 AI 提问作为上下文。
 * 用与服务端**同一套**归一化规则，避免"服务端说有证据、界面却定位不到"。
 */
function findTurnContext(
  quote: string,
  transcriptObject: TranscriptTurn[] | null | undefined,
  offsetMs: number | null,
): { asker: TranscriptTurn | null; speaker: TranscriptTurn } | null {
  if (!Array.isArray(transcriptObject) || transcriptObject.length === 0) {
    return null;
  }
  const normalizedQuote = normalizeTranscriptForMatch(quote);
  let index = -1;

  if (typeof offsetMs === "number" && Number.isFinite(offsetMs)) {
    index = transcriptObject.findIndex(
      (turn) => turn.role === "user" && turn.offset_ms === offsetMs,
    );
  }
  if (index < 0 && normalizedQuote.length >= 4) {
    index = transcriptObject.findIndex(
      (turn) =>
        turn.role === "user" && normalizeTranscriptForMatch(turn.content).includes(normalizedQuote),
    );
  }
  if (index < 0) {
    return null;
  }

  const speaker = transcriptObject[index];
  const asker =
    index > 0 && transcriptObject[index - 1].role === "agent" ? transcriptObject[index - 1] : null;

  return { asker, speaker };
}

/**
 * 能力维度证据面板。
 *
 * 设计取舍：**不要把所有长文本堆进表格单元格**（需求明确要求），
 * 所以结果页用「点击维度 → 展开结论/风险/原话」的方式呈现，表格里只放紧凑的分数摘要。
 */
function EvidencePanel({ scores, transcriptObject }: Props) {
  const [expanded, setExpanded] = useState<string | null>(scores[0]?.name ?? null);
  const [locating, setLocating] = useState<string | null>(null);

  if (!Array.isArray(scores) || scores.length === 0) {
    return null;
  }

  return (
    <div className="bg-slate-200 rounded-2xl min-h-[120px] p-4 px-5 my-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold my-2">能力维度证据</p>
        <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-600">
          点击维度可展开结论、风险与候选人原话
        </span>
      </div>

      <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>{ALERT_NOTE}</span>
      </p>

      <div className="space-y-2">
        {scores.map((score) => {
          const isOpen = expanded === score.name;
          const hasEvidence = score.evidence.length > 0;

          return (
            <div key={score.name} className="overflow-hidden rounded-xl bg-white">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : score.name)}
                aria-expanded={isOpen}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-slate-50"
              >
                {isOpen ? (
                  <ChevronDown size={16} className="shrink-0 text-slate-500" />
                ) : (
                  <ChevronRight size={16} className="shrink-0 text-slate-500" />
                )}
                <span className="font-medium text-slate-900">{score.name}</span>
                <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-sm font-semibold text-indigo-700">
                  {score.score === null ? "未评估" : `${score.score} 分`}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs ${hasEvidence ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                >
                  {hasEvidence ? `证据 ${score.evidence.length} 条` : "缺少证据"}
                </span>
                {score.riskFlags.length > 0 && (
                  <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs text-rose-700">
                    风险 {score.riskFlags.length} 项
                  </span>
                )}
              </button>

              {isOpen && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-700">结论</p>
                    <p className="mt-1 whitespace-pre-wrap leading-6 text-slate-700">
                      {score.feedback || "模型没有给出该维度的结论。"}
                    </p>
                  </div>

                  {score.riskFlags.length > 0 && (
                    <div className="mt-3">
                      <p className="flex items-center gap-1.5 font-medium text-slate-700">
                        <ShieldAlert size={14} className="text-rose-500" />
                        风险提示
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {score.riskFlags.map((flag) => (
                          <span
                            key={flag}
                            className="rounded-md bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
                          >
                            {flag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-3">
                    <p className="flex items-center gap-1.5 font-medium text-slate-700">
                      <Quote size={14} className="text-indigo-500" />
                      候选人原话证据
                    </p>

                    {hasEvidence ? (
                      <ul className="mt-1.5 space-y-2">
                        {score.evidence.map((evidence, index) => {
                          const locateKey = `${score.name}-${index}`;
                          const context = findTurnContext(
                            evidence.quote,
                            transcriptObject,
                            evidence.transcriptOffsetMs,
                          );
                          const isLocating = locating === locateKey;

                          return (
                            <li
                              key={locateKey}
                              className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                            >
                              <p className="leading-6 text-slate-800">“{evidence.quote}”</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                <span>
                                  {evidence.transcriptOffsetMs === null
                                    ? "位置未知"
                                    : formatOffset(evidence.transcriptOffsetMs)}
                                </span>
                                {context ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setLocating(isLocating ? null : locateKey)}
                                  >
                                    {isLocating ? "收起逐字稿" : "查看该段逐字稿"}
                                  </Button>
                                ) : (
                                  <span className="text-amber-700">
                                    未能定位到逐字稿轮次（本次面试没有结构化逐字稿）
                                  </span>
                                )}
                              </div>

                              {isLocating && context && (
                                <div className="mt-2 space-y-1.5 rounded-lg bg-white p-3 text-xs leading-5">
                                  {context.asker && (
                                    <p className="text-slate-500">
                                      <span className="font-medium text-slate-600">
                                        AI 面试官：
                                      </span>
                                      {context.asker.content}
                                    </p>
                                  )}
                                  <p className="text-slate-800">
                                    <span className="font-medium">候选人：</span>
                                    {context.speaker.content}
                                  </p>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="mt-1.5 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                        缺少证据：没有找到能在候选人逐字稿中逐字核对的原话。
                        可能是该维度候选人没有正面回答，或本次面试没有结构化逐字稿用于核验。 请 HR
                        人工查看逐字稿后判断。
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default EvidencePanel;
