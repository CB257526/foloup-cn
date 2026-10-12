"use client";

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
import type { Analytics, CallData } from "@/types/response";
import { CircularProgress } from "@nextui-org/react";
import { ScrollArea } from "@radix-ui/react-scroll-area";
import axios from "axios";
import { TrashIcon } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { marked } from "marked";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";

type CallProps = {
  call_id: string;
  onDeleteResponse: (deletedCallId: string) => void;
  onCandidateStatusChange: (callId: string, newStatus: string) => void;
};

/** `CallData.end_reason` 的中文说明 */
const END_REASON_TEXT: Record<string, string> = {
  candidate_ended: "候选人主动结束",
  time_up: "到达面试时长上限",
  connection_closed: "语音连接中断",
  error: "通话异常结束",
};

function CallInfo({ call_id, onDeleteResponse, onCandidateStatusChange }: CallProps) {
  const [call, setCall] = useState<CallData>();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [isClicked, setIsClicked] = useState(false);
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [candidateStatus, setCandidateStatus] = useState<string>("");
  const [interviewId, setInterviewId] = useState<string>("");
  const [tabSwitchCount, setTabSwitchCount] = useState<number>();

  useEffect(() => {
    const fetchResponses = async () => {
      setIsLoading(true);
      setCall(undefined);
      setEmail("");
      setName("");

      try {
        const response = await axios.post("/api/get-call", { id: call_id });
        setCall(response.data.callResponse);
        setAnalytics(response.data.analytics);
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchResponses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call_id]);

  useEffect(() => {
    const fetchEmail = async () => {
      setIsLoading(true);
      try {
        const response = await ResponseService.getResponseByCallId(call_id);
        setEmail(response.email);
        setName(response.name ?? "");
        setCandidateStatus(response.candidate_status);
        setInterviewId(response.interview_id);
        setTabSwitchCount(response.tab_switch_count);
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
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
              {/* <p className="font-semibold my-2 ml-2">
                面试记录分析
              </p> */}
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
                          <AlertDialogTitle>Are you sure?</AlertDialogTitle>

                          <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete this
                            response.
                          </AlertDialogDescription>
                        </AlertDialogHeader>

                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>

                          <AlertDialogAction
                            className="bg-indigo-600 hover:bg-indigo-800"
                            onClick={async () => {
                              await onDeleteResponseClick();
                            }}
                          >
                            Continue
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            </div>
            {/* <div>{call.}</div> */}
          </div>
          <div className="bg-slate-200 rounded-2xl min-h-[120px] p-4 px-5 my-3">
            <p className="font-semibold my-2">综合分析</p>

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
                  {END_REASON_TEXT[call?.end_reason ?? ""] ?? "—"}
                </div>
                <div className="font-medium">
                  <span className="font-normal">录音：</span>
                  未保存，仅保留逐字稿和评分
                </div>
              </div>
            </div>
          </div>
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

export default CallInfo;
