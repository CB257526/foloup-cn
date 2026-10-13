"use client";

import EvidencePanel from "@/components/dashboard/interview/evidencePanel";
import QuestionAnswerCard from "@/components/dashboard/interview/questionAnswerCard";
import LoaderWithText from "@/components/loaders/loader-with-text/loaderWithText";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CandidateStatus } from "@/lib/enum";
import { ResponseService } from "@/services/responses.service";
import type { AnalysisErrorInfo, AnalysisStatus, Analytics, CallData } from "@/types/response";
import { ALERT_NOTE, CALL_END_REASON_TEXT, describeAnalysisFailure } from "@/types/response";
import { CircularProgress } from "@nextui-org/react";
import { ScrollArea } from "@radix-ui/react-scroll-area";
import axios from "axios";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCw, TrashIcon } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { marked } from "marked";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type CallProps = {
  call_id: string;
  onDeleteResponse: (deletedCallId: string) => void;
  onCandidateStatusChange: (callId: string, newStatus: string) => void;
};

/** 评分中的轮询节奏：4 秒一次，最多约 2.7 分钟，避免 HR 一直盯着一个不动的页面。 */
const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 40;

function CallInfo({ call_id, onDeleteResponse, onCandidateStatusChange }: CallProps) {
  const [call, setCall] = useState<CallData>();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [analysisError, setAnalysisError] = useState<AnalysisErrorInfo | null>(null);
  const [isScoring, setIsScoring] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);

  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [isClicked, setIsClicked] = useState(false);
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [candidateStatus, setCandidateStatus] = useState<string>("");
  const [interviewId, setInterviewId] = useState<string>("");
  const [tabSwitchCount, setTabSwitchCount] = useState<number>();

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  /**
   * 拉取结果与评分状态。
   * `retry=true` 表示 HR 明确点了「重新评分」，服务端才会重新领取评分任务。
   */
  const fetchCall = useCallback(
    async (retry: boolean) => {
      try {
        const response = await axios.post(
          "/api/get-call",
          { id: call_id, retry },
          // 显式禁用缓存：重新评分后必须看到新结果，而不是浏览器缓存的旧评分。
          { headers: { "Cache-Control": "no-store" } },
        );
        const data = response.data ?? {};

        setCall(data.callResponse ?? undefined);

        /**
         * ⚠️ 「评分状态」和「评分内容」是两个独立状态。
         *
         * processing / failed 的响应里本来就没有新评分，但这**不代表没有评分**：
         * 上一次成功的结果一直留在库里，服务端也会一并返回。用空值覆盖会把页面上原有的
         * 评分抹掉（HR 会以为重新评分把结果弄丢了），所以只有服务端真的给了评分才替换；
         * 新任务成功提交后服务端才会给新值，失败则继续沿用旧值。
         */
        const incomingAnalytics = (data.analytics ?? null) as Analytics | null;
        if (incomingAnalytics) {
          setAnalytics(incomingAnalytics);
        }

        setAnalysisError((data.analysis_error ?? null) as AnalysisErrorInfo | null);
        setAnalysisStatus(
          (data.analysis_status as AnalysisStatus) ?? (data.analytics ? "completed" : "idle"),
        );

        return data as { analysis_status?: AnalysisStatus };
      } catch (error) {
        console.error(error);

        return null;
      }
    },
    [call_id],
  );

  /** 评分中轮询：状态不再是 processing 就停下。 */
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }
    let attempts = 0;
    const tick = async () => {
      if (cancelledRef.current) {
        return;
      }
      attempts += 1;
      const data = await fetchCall(false);
      if (cancelledRef.current) {
        return;
      }
      if (data?.analysis_status === "processing") {
        if (attempts >= MAX_POLLS) {
          setPollTimedOut(true);

          return;
        }
        pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
  }, [fetchCall]);

  useEffect(() => {
    cancelledRef.current = false;
    setPollTimedOut(false);
    setIsLoading(true);
    void fetchCall(false).then((data) => {
      setIsLoading(false);
      if (!cancelledRef.current && data?.analysis_status === "processing") {
        startPolling();
      }
    });

    return () => {
      cancelledRef.current = true;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, [fetchCall, startPolling]);

  useEffect(() => {
    const fetchEmail = async () => {
      try {
        const response = await ResponseService.getResponseByCallId(call_id);

        setEmail(response.email);
        setName(response.name ?? "");
        setCandidateStatus(response.candidate_status);
        setInterviewId(response.interview_id);
        setTabSwitchCount(response.tab_switch_count);
      } catch (error) {
        console.error(error);
      }
    };

    fetchEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call_id]);

  useEffect(() => {
    const replaceAgentAndUser = (transcript: string, name: string): string => {
      const agentReplacement = "**AI 面试官：**";
      const userReplacement = `**${name}:**`;

      // 兼容旧记录中的英文角色前缀，展示时统一为中文，避免 HR 在结果页来回切换语言。
      let updatedTranscript = transcript
        .replace(/Agent:/g, agentReplacement)
        .replace(/User:/g, userReplacement);

      // Add space between the dialogues
      updatedTranscript = updatedTranscript.replace(/(?:\r\n|\r|\n)/g, "\n\n");

      return updatedTranscript;
    };

    if (call && name) {
      setTranscript(replaceAgentAndUser(call?.transcript as string, name));
    }
  }, [call, name]);

  /**
   * HR 显式「重新评分」。
   *
   * 服务端用一条原子 UPDATE 领取任务：快速连点或并发请求只会有一个真正调用模型，
   * 也不会产生第二条 response。这里再做一个前端兜底（按钮在评分中禁用）。
   */
  const handleRetry = async () => {
    if (isScoring || analysisStatus === "processing") {
      return;
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }
    setPollTimedOut(false);
    setIsScoring(true);

    // 乐观显示"评分中"，请求失败时再回滚到原状态。
    const previousStatus = analysisStatus;
    const previousError = analysisError;
    const previousAnalytics = analytics;
    setAnalysisStatus("processing");
    setAnalysisError(null);

    const data = await fetchCall(true);
    setIsScoring(false);

    if (!data) {
      setAnalysisStatus(previousStatus);
      setAnalysisError(previousError);
      setAnalytics(previousAnalytics);
      toast.error("重新评分请求失败", { description: "请检查网络后重试。" });

      return;
    }

    if (data.analysis_status === "processing") {
      toast.success("已开始重新评分", { description: "评分完成后本页会自动刷新。" });
      startPolling();
    }
  };

  const onDeleteResponseClick = async () => {
    try {
      const response = await ResponseService.getResponseByCallId(call_id);

      if (response) {
        const interview_id = response.interview_id;

        await ResponseService.deleteResponse(call_id);

        router.push(`/interviews/${interview_id}`);

        onDeleteResponse(call_id);
      }

      toast.success("面试记录已删除。", {
        position: "bottom-right",

        duration: 3000,
      });
    } catch (error) {
      console.error("Error deleting response:", error);

      toast.error("删除面试记录失败。", {
        position: "bottom-right",

        duration: 3000,
      });
    }
  };

  const hasCompetencyEvidence =
    Array.isArray(analytics?.competencyScores) && analytics.competencyScores.length > 0;
  // 旧版评分（P2 之前的记录）只有 overallScore 等字段：结果页要能正常打开，
  // 并且**不能**给它编造能力分，只提示可以重新评分补齐。
  const isLegacyAnalytics =
    analytics?.overallScore !== undefined &&
    analytics?.overallScore !== null &&
    !hasCompetencyEvidence;

  // 「上一次成功的评分还在不在」——重新评分中 / 重评失败 / 未配置密钥时都必须明确告诉 HR，
  // 否则他看到「评分中/失败」会以为原来的结果被弄丢了（其实一直留在库里并在下方展示）。
  const hasPreviousScore =
    analytics?.overallScore !== undefined && analytics?.overallScore !== null;

  // 旧版评分没有结构化能力证据，状态条不能引导 HR 去看一个不存在的区块。
  const statusView = buildStatusView(
    analysisStatus,
    analysisError,
    pollTimedOut,
    isLegacyAnalytics,
    hasPreviousScore,
  );
  const canRetry = !isScoring && analysisStatus !== "processing";

  return (
    <div className="h-auto min-h-screen z-[10] mx-0 md:mx-2 mb-[100px] overflow-y-auto">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-[75%] w-full">
          <LoaderWithText />
        </div>
      ) : (
        <>
          <div className="bg-slate-200 rounded-2xl min-h-[120px] p-4 px-5 y-3">
            <div className="flex flex-col justify-between bt-2">
              <div>
                <div className="flex justify-between items-center pb-4 pr-2">
                  <button
                    type="button"
                    className="inline-flex items-center text-indigo-600 hover:cursor-pointer"
                    onClick={() => {
                      router.push(`/interviews/${interviewId}`);
                    }}
                  >
                    <ArrowLeft className="mr-2" />
                    <p className="text-sm font-semibold">返回岗位概览</p>
                  </button>
                  {tabSwitchCount && tabSwitchCount > 0 && (
                    <p className="text-sm font-semibold text-red-500 bg-red-200 rounded-sm px-2 py-1">
                      检测到切屏行为
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col justify-between gap-3 w-full">
                <div className="flex flex-col md:flex-row md:justify-between gap-3">
                  <div className="flex flex-row gap-3">
                    <Avatar>
                      <AvatarFallback>{name ? name[0] : "A"}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      {name && <p className="text-sm font-semibold px-2">{name}</p>}
                      {email && <p className="text-sm px-2">{email}</p>}
                    </div>
                  </div>
                  <div className="flex flex-row flex-wrap mr-2 items-center gap-3">
                    <Select
                      value={candidateStatus}
                      onValueChange={async (newValue: string) => {
                        setCandidateStatus(newValue);
                        await ResponseService.updateResponse(
                          { candidate_status: newValue },
                          call_id,
                        );
                        onCandidateStatusChange(call_id, newValue);
                      }}
                    >
                      <SelectTrigger className="w-[180px]  bg-slate-50 rounded-2xl">
                        <SelectValue placeholder="待筛选" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={CandidateStatus.NO_STATUS}>
                          <div className="flex items-center">
                            <div className="w-3 h-3 bg-gray-400 rounded-full mr-2" />
                            No Status
                          </div>
                        </SelectItem>
                        <SelectItem value={CandidateStatus.NOT_SELECTED}>
                          <div className="flex items-center">
                            <div className="w-3 h-3 bg-red-500 rounded-full mr-2" />
                            未选中
                          </div>
                        </SelectItem>
                        <SelectItem value={CandidateStatus.POTENTIAL}>
                          <div className="flex items-center">
                            <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2" />
                            潜力人选
                          </div>
                        </SelectItem>
                        <SelectItem value={CandidateStatus.SELECTED}>
                          <div className="flex items-center">
                            <div className="w-3 h-3 bg-green-500 rounded-full mr-2" />
                            已选中
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button disabled={isClicked} className="bg-red-500 hover:bg-red-600 p-2">
                          <TrashIcon size={16} className="" />
                        </Button>
                      </AlertDialogTrigger>

                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确定删除这条面试记录吗？</AlertDialogTitle>

                          <AlertDialogDescription>
                            此操作无法撤销，将永久删除该候选人的逐字稿与评分结果。
                          </AlertDialogDescription>
                        </AlertDialogHeader>

                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>

                          <AlertDialogAction
                            className="bg-indigo-600 hover:bg-indigo-800"
                            onClick={async () => {
                              setIsClicked(true);
                              await onDeleteResponseClick();
                              setIsClicked(false);
                            }}
                          >
                            继续
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 评分状态条：评分中 / 成功 / 失败 / 未配置密钥 / 尚未评分，都必须给出中文可操作说明。 */}
          <div
            className={`my-3 flex flex-col gap-3 rounded-2xl border p-4 px-5 sm:flex-row sm:items-center sm:justify-between ${statusView.containerClass}`}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 shrink-0">{statusView.icon}</span>
              <div className="min-w-0">
                <p className="font-semibold">{statusView.title}</p>
                <p className="mt-1 text-sm leading-5 text-slate-600">{statusView.hint}</p>
                {statusView.backupHint && (
                  <p className="mt-1 text-xs font-medium text-slate-700">{statusView.backupHint}</p>
                )}
                {pollTimedOut && analysisStatus === "processing" && (
                  <p className="mt-1 text-xs text-amber-700">
                    评分已进行较长时间仍未结束，页面不再自动刷新。可稍后手动刷新，或点击「重新评分」重新领取任务。
                  </p>
                )}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 bg-white"
              disabled={!canRetry}
              onClick={() => void handleRetry()}
            >
              {isScoring ? (
                <Loader2 size={16} className="mr-2 animate-spin" />
              ) : (
                <RefreshCw size={16} className="mr-2" />
              )}
              重新评分
            </Button>
          </div>

          <div className="bg-slate-200 rounded-2xl min-h-[120px] p-4 px-5 my-3">
            <p className="font-semibold my-2">综合分析</p>
            <p className="mb-2 flex items-start gap-1.5 text-xs text-slate-600">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{ALERT_NOTE}</span>
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-2 mt-4">
              {analytics?.overallScore !== undefined && (
                <div className="flex flex-col gap-3 text-sm p-4 rounded-2xl bg-slate-50">
                  <div className="flex flex-row gap-2 align-middle">
                    <CircularProgress
                      classNames={{
                        svg: "w-28 h-28 drop-shadow-md",
                        indicator: "stroke-indigo-600",
                        track: "stroke-indigo-600/10",
                        value: "text-3xl font-semibold text-indigo-600",
                      }}
                      value={analytics?.overallScore}
                      strokeWidth={4}
                      showValueLabel={true}
                      formatOptions={{ signDisplay: "never" }}
                    />
                    <p className="font-medium my-auto text-xl">综合评分</p>
                  </div>
                  <div className="">
                    <div className="font-medium ">
                      <span className="font-normal">评价： </span>
                      {analytics?.overallFeedback === undefined ? (
                        <Skeleton className="w-[200px] h-[20px]" />
                      ) : (
                        analytics?.overallFeedback
                      )}
                    </div>
                  </div>
                </div>
              )}
              {analytics?.communication && (
                <div className="flex flex-col gap-3 text-sm p-4 rounded-2xl bg-slate-50">
                  <div className="flex flex-row gap-2 align-middle">
                    <CircularProgress
                      classNames={{
                        svg: "w-28 h-28 drop-shadow-md",
                        indicator: "stroke-indigo-600",
                        track: "stroke-indigo-600/10",
                        value: "text-3xl font-semibold text-indigo-600",
                      }}
                      value={analytics?.communication.score}
                      maxValue={10}
                      minValue={0}
                      strokeWidth={4}
                      showValueLabel={true}
                      valueLabel={
                        <div className="flex items-baseline">
                          {analytics?.communication.score ?? 0}
                          <span className="text-xl ml-0.5">/10</span>
                        </div>
                      }
                      formatOptions={{ signDisplay: "never" }}
                    />
                    <p className="font-medium my-auto text-xl">沟通表达</p>
                  </div>
                  <div className="">
                    <div className="font-medium ">
                      <span className="font-normal">评价： </span>
                      {analytics?.communication.feedback === undefined ? (
                        <Skeleton className="w-[200px] h-[20px]" />
                      ) : (
                        analytics?.communication.feedback
                      )}
                    </div>
                  </div>
                </div>
              )}
              {/* 原 Retell 的「候选人情绪 / 通话总结」卡片改成我们自己能测到的过程指标 */}
              <div className="flex flex-col gap-2 text-sm p-4 rounded-2xl bg-slate-50">
                <p className="font-semibold">面试过程</p>
                <div className="font-medium">
                  <span className="font-normal">时长：</span>
                  {call?.duration ? `${Math.round(call.duration)} 秒` : "—"}
                </div>
                <div className="font-medium">
                  <span className="font-normal">打断次数：</span>
                  {call?.stats?.interruption_count ?? 0}
                </div>
                <div className="font-medium">
                  <span className="font-normal">平均响应延迟：</span>
                  {call?.stats?.latency_avg ? `${call.stats.latency_avg} 秒` : "—"}
                </div>
                <div className="font-medium">
                  <span className="font-normal">结束原因：</span>
                  {CALL_END_REASON_TEXT[call?.end_reason ?? ""] ?? "—"}
                </div>
                <div className="font-medium">
                  <span className="font-normal">录音：</span>
                  未保存，仅保留逐字稿和评分
                </div>
              </div>
            </div>
          </div>

          {analytics?.softSkillSummary && (
            <div className="bg-slate-200 rounded-2xl p-4 px-5 my-3">
              <p className="font-semibold my-2">软素质总结</p>
              <p className="text-sm leading-6 text-slate-700">{analytics.softSkillSummary}</p>
            </div>
          )}

          {/* 能力维度证据：结论 + 风险 + 可核验的候选人原话（表格里只放紧凑摘要，长文本在这里展开） */}
          {hasCompetencyEvidence && (
            <EvidencePanel
              scores={analytics?.competencyScores ?? []}
              transcriptObject={call?.transcript_object}
            />
          )}

          {analytics?.questionSummaries && analytics.questionSummaries.length > 0 && (
            <div className="bg-slate-200 rounded-2xl min-h-[120px] p-4 px-5 my-3">
              <p className="font-semibold my-2 mb-4">逐题分析</p>
              <ScrollArea className="rounded-md h-72 text-sm mt-3 py-3 leading-6 overflow-y-scroll whitespace-pre-line px-2">
                {analytics?.questionSummaries.map((qs, index) => (
                  <QuestionAnswerCard
                    key={qs.question}
                    questionNumber={index + 1}
                    question={qs.question}
                    answer={qs.summary}
                  />
                ))}
              </ScrollArea>
            </div>
          )}
          <div className="bg-slate-200 rounded-2xl min-h-[150px] max-h-[500px] p-4 px-5 mb-[150px]">
            <p className="font-semibold my-2 mb-4">面试逐字稿</p>
            <ScrollArea className="rounded-2xl text-sm h-96  overflow-y-auto whitespace-pre-line px-2">
              <div
                className="text-sm p-4 rounded-2xl leading-5 bg-slate-50"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: required for markdown rendering
                dangerouslySetInnerHTML={{ __html: marked(transcript) }}
              />
            </ScrollArea>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 评分状态 → 中文标题、说明与配色。
 *
 * `hasPreviousScore` 表示库里还留着上一次成功的评分：只要当前状态不是「已生成」，
 * 就必须额外说明「旧评分仍然可参考」，不能让 HR 以为重新评分把结果覆盖没了。
 */
function buildStatusView(
  status: AnalysisStatus,
  error: AnalysisErrorInfo | null,
  pollTimedOut: boolean,
  isLegacy: boolean,
  hasPreviousScore: boolean,
) {
  const keepNote = hasPreviousScore ? "上一次的成功评分已保留，下方结果可继续参考。" : "";

  switch (status) {
    case "processing":
      return {
        title: "AI 正在评分…",
        hint: pollTimedOut
          ? "评分仍在进行中。"
          : "评分完成后本页会自动刷新，无需重复点击「重新评分」。",
        backupHint: keepNote,
        containerClass: "border-indigo-200 bg-indigo-50",
        icon: <Loader2 size={18} className="animate-spin text-indigo-600" />,
      };
    case "completed":
      return {
        title: isLegacy ? "AI 评分已生成（旧版评分）" : "AI 评分已生成",
        hint: isLegacy
          ? "这条记录只有综合评分，没有结构化能力维度证据。点击「重新评分」可补齐分项与候选人原话。"
          : "可以点开下方「能力维度证据」查看每一项结论与候选人原话。",
        // 已经在看这次的结果了，不需要再提示「旧评分」。
        backupHint: "",
        containerClass: "border-emerald-200 bg-emerald-50",
        icon: <CheckCircle2 size={18} className="text-emerald-600" />,
      };
    case "failed":
      return {
        title: hasPreviousScore ? "本次重新评分未完成（已保留上次评分）" : "AI 评分失败",
        hint: describeAnalysisFailure(error),
        backupHint: keepNote,
        containerClass: "border-rose-200 bg-rose-50",
        icon: <AlertTriangle size={18} className="text-rose-600" />,
      };
    case "no_api_key":
      return {
        title: "尚未配置模型 API 密钥",
        hint: describeAnalysisFailure(error ?? { code: "no_api_key", message: "" }),
        backupHint: keepNote,
        containerClass: "border-amber-200 bg-amber-50",
        icon: <KeyRound size={18} className="text-amber-600" />,
      };
    default:
      return {
        title: "尚未评分",
        hint: "点击「重新评分」触发一次 AI 评分。",
        backupHint: "",
        containerClass: "border-slate-200 bg-slate-100",
        icon: <AlertTriangle size={18} className="text-slate-500" />,
      };
  }
}

export default CallInfo;
