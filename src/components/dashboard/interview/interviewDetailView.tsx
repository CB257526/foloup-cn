"use client";

import CallInfo from "@/components/call/callInfo";
import CandidateManager from "@/components/dashboard/interview/candidateManager";
import EditInterview from "@/components/dashboard/interview/editInterview";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import type { CandidateInviteListItem } from "@/lib/data/candidates";
import { CandidateStatus } from "@/lib/enum";
import { formatTimestampToDateHHMM } from "@/lib/utils";
import { InterviewService } from "@/services/interviews.service";
import type { Interview } from "@/types/interview";
import type { Interviewer } from "@/types/interviewer";
import type { Response } from "@/types/response";
import { ArrowLeft, Pencil, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

interface Props {
  interviewId: string;
  callId?: string;
  edit?: boolean;
  interview: Interview | null;
  responses: Response[];
  interviewers: Interviewer[];
  candidateInvites: CandidateInviteListItem[];
}

/** 岗位详情优先展示候选人专属链接，历史面试结果仍保留独立查看入口。 */
function InterviewDetailView({
  interviewId,
  callId,
  edit,
  interview,
  responses: initialResponses,
  interviewers,
  candidateInvites: initialInvites,
}: Props) {
  const [responses, setResponses] = useState(initialResponses);
  const [candidateInvites, setCandidateInvites] = useState(initialInvites);
  const [isActive, setIsActive] = useState(interview?.is_active ?? true);
  const router = useRouter();

  React.useEffect(() => setResponses(initialResponses), [initialResponses]);
  React.useEffect(() => setCandidateInvites(initialInvites), [initialInvites]);
  React.useEffect(() => setIsActive(interview?.is_active ?? true), [interview?.is_active]);

  const handleToggle = async (checked: boolean) => {
    setIsActive(checked);
    try {
      await InterviewService.updateInterview({ is_active: checked }, interviewId);
      toast.success(checked ? "岗位已开放" : "岗位已暂停", {
        description: checked
          ? "候选人可以继续使用有效的专属链接。"
          : "候选人暂时不能开始新的面试。",
      });
      router.refresh();
    } catch (error) {
      setIsActive(!checked);
      toast.error("更新岗位状态失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    }
  };

  const handleCandidateStatusChange = (targetCallId: string, status: string) => {
    setResponses((current) =>
      current.map((response) =>
        response.call_id === targetCallId ? { ...response, candidate_status: status } : response,
      ),
    );
  };

  const handleDeleteResponse = (targetCallId: string) => {
    setResponses((current) => current.filter((response) => response.call_id !== targetCallId));
    setCandidateInvites((current) =>
      current.map((invite) =>
        invite.call_id === targetCallId
          ? { ...invite, call_id: null, response_duration: null }
          : invite,
      ),
    );
    if (callId === targetCallId) {
      router.push(`/interviews/${interviewId}`);
    }
  };

  if (!interview) {
    return <div className="p-8 text-sm text-slate-500">岗位不存在或已被删除。</div>;
  }

  return (
    <div className="flex min-h-full flex-col gap-3 bg-slate-50 p-3 md:p-5">
      <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between md:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            {callId ? (
              <button
                type="button"
                onClick={() => router.push(`/interviews/${interviewId}`)}
                className="inline-flex items-center text-indigo-600 hover:text-indigo-800"
              >
                <ArrowLeft size={16} className="mr-1" />
                返回岗位候选人
              </button>
            ) : (
              <span className="inline-flex items-center gap-1">
                <UsersRound size={15} />
                岗位候选人工作台
              </span>
            )}
          </div>
          <h1 className="mt-1 truncate text-xl font-semibold text-slate-900">{interview.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            预计面试 {interview.time_duration || 20} 分钟 · {candidateInvites.length} 位候选人
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 md:justify-end">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>{isActive ? "接收面试" : "已暂停"}</span>
            <Switch
              checked={isActive}
              onCheckedChange={handleToggle}
              aria-label="切换岗位开放状态"
            />
          </div>
          {!callId && !edit && (
            <Button
              variant="outline"
              onClick={() => router.push(`/interviews/${interviewId}?edit=true`)}
            >
              <Pencil size={15} className="mr-2" />
              编辑岗位模板
            </Button>
          )}
        </div>
      </header>

      {callId ? (
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(250px,320px)_minmax(0,1fr)]">
          <aside className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="font-semibold text-slate-900">已生成的面试结果</h2>
              <p className="mt-1 text-xs text-slate-500">共 {responses.length} 条已完成记录</p>
            </div>
            <ScrollArea className="max-h-[72vh] p-2">
              <div className="space-y-1">
                {responses.map((response) => (
                  <button
                    key={response.call_id}
                    type="button"
                    onClick={() =>
                      router.push(`/interviews/${interviewId}?call=${response.call_id}`)
                    }
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left text-sm transition ${response.call_id === callId ? "border-indigo-300 bg-indigo-50" : "border-transparent hover:bg-slate-50"}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-800">
                        {response.name || "匿名候选人"}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {formatTimestampToDateHHMM(String(response.created_at))}
                      </span>
                    </span>
                    <span className="ml-3 rounded-full border border-indigo-200 bg-white px-2 py-1 text-xs text-indigo-700">
                      {response.analytics?.overallScore ?? "待评分"}
                    </span>
                  </button>
                ))}
                {responses.length === 0 && (
                  <p className="px-3 py-8 text-center text-sm text-slate-500">
                    还没有已完成的面试记录。
                  </p>
                )}
              </div>
            </ScrollArea>
          </aside>
          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 md:p-5">
            <CallInfo
              call_id={callId}
              onDeleteResponse={handleDeleteResponse}
              onCandidateStatusChange={handleCandidateStatusChange}
            />
          </div>
        </div>
      ) : edit ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 md:p-5">
          <EditInterview interview={interview} interviewers={interviewers} />
        </div>
      ) : (
        <CandidateManager
          interview={interview}
          invites={candidateInvites}
          responses={responses}
          interviewers={interviewers}
        />
      )}
    </div>
  );
}

export default InterviewDetailView;
