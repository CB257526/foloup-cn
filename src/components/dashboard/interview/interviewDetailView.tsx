"use client";

import CallInfo from "@/components/call/callInfo";
import Modal from "@/components/dashboard/Modal";
import EditInterview from "@/components/dashboard/interview/editInterview";
import SharePopup from "@/components/dashboard/interview/sharePopup";
import SummaryInfo from "@/components/dashboard/interview/summaryInfo";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CandidateStatus } from "@/lib/enum";
import { formatTimestampToDateHHMM } from "@/lib/utils";
import { InterviewService } from "@/services/interviews.service";
import { ResponseService } from "@/services/responses.service";
import type { Interview } from "@/types/interview";
import type { Interviewer } from "@/types/interviewer";
import type { Response } from "@/types/response";
import { Clock3, Eye, Filter, Palette, Pencil, Share2, UserIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { ChromePicker } from "react-color";
import { toast } from "sonner";

/**
 * 原 `app/(client)/interviews/[interviewId]/page.tsx` 的客户端部分。
 *
 * 变更：
 * - interview / responses / interviewers 由服务端页面查出后经 props 传入（原版来自 context + 浏览器直连 Supabase）
 * - 删除套餐计费分支（currentPlan === "free_trial_over" 的 Inactive + Upgrade 提示）
 * - 写操作改走 Server Action，随后 router.refresh()
 * 外观与布局其余部分未改动。
 */

interface Props {
  interviewId: string;
  callId?: string;
  edit?: boolean;
  interview: Interview | null;
  responses: Response[];
  interviewers: Interviewer[];
}

const base_url = process.env.NEXT_PUBLIC_LIVE_URL;

function InterviewDetailView({
  interviewId,
  callId,
  edit,
  interview,
  responses: initialResponses,
  interviewers,
}: Props) {
  const [interviewState, setInterviewState] = useState<Interview | null>(interview);
  const [responses, setResponses] = useState<Response[]>(initialResponses);
  const [isSharePopupOpen, setIsSharePopupOpen] = useState(false);
  const router = useRouter();
  const [isActive, setIsActive] = useState<boolean>(interview?.is_active ?? true);
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);
  const [themeColor, setThemeColor] = useState<string>(interview?.theme_color ?? "#4F46E5");
  const [iconColor, seticonColor] = useState<string>(interview?.theme_color ?? "#4F46E5");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  const seeInterviewPreviewPage = () => {
    const protocol = base_url?.includes("localhost") ? "http" : "https";
    if (interviewState?.url) {
      const url = interviewState?.readable_slug
        ? `${protocol}://${base_url}/call/${interviewState?.readable_slug}`
        : interviewState.url.startsWith("http")
          ? interviewState.url
          : `https://${interviewState.url}`;
      window.open(url, "_blank");
    } else {
      console.error("Interview URL is null or undefined.");
    }
  };

  const handleDeleteResponse = (deletedCallId: string) => {
    setResponses((prev) => {
      const next = prev.filter((response) => response.call_id !== deletedCallId);
      if (callId === deletedCallId) {
        router.push(`/interviews/${interviewId}`);
      }
      return next;
    });
  };

  const handleResponseClick = async (response: Response) => {
    try {
      await ResponseService.saveResponse({ is_viewed: true }, response.call_id);
      setResponses((prev) =>
        prev.map((r) => (r.call_id === response.call_id ? { ...r, is_viewed: true } : r)),
      );
    } catch (error) {
      console.error(error);
    }
  };

  const handleToggle = async () => {
    try {
      const updatedIsActive = !isActive;
      setIsActive(updatedIsActive);

      await InterviewService.updateInterview({ is_active: updatedIsActive }, interviewId);

      toast.success("岗位状态已更新", {
        description: `该岗位现在${updatedIsActive ? "开放中" : "已关闭"}。`,
        position: "bottom-right",
        duration: 3000,
      });
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("错误", {
        description: "更新岗位状态失败。",
        duration: 3000,
      });
    }
  };

  const handleThemeColorChange = async (newColor: string) => {
    try {
      await InterviewService.updateInterview({ theme_color: newColor }, interviewId);

      toast.success("主题色已更新", {
        position: "bottom-right",
        duration: 3000,
      });
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error("错误", {
        description: "更新主题色失败。",
        duration: 3000,
      });
    }
  };

  const handleCandidateStatusChange = (callId: string, newStatus: string) => {
    setResponses((prevResponses) => {
      return prevResponses?.map((response) =>
        response.call_id === callId ? { ...response, candidate_status: newStatus } : response,
      );
    });
  };

  const openSharePopup = () => {
    setIsSharePopupOpen(true);
  };

  const closeSharePopup = () => {
    setIsSharePopupOpen(false);
  };

  const handleColorChange = (color: { hex: string }) => {
    setThemeColor(color.hex);
  };

  const applyColorChange = () => {
    if (themeColor !== iconColor) {
      seticonColor(themeColor);
      handleThemeColorChange(themeColor);
    }
    setShowColorPicker(false);
  };

  const filterResponses = () => {
    if (!responses) {
      return [];
    }
    if (filterStatus === "ALL") {
      return responses;
    }

    return responses?.filter((response) => response?.candidate_status === filterStatus);
  };

  return (
    <div className="flex flex-col w-full min-w-0 h-full p-1 md:p-2 bg-white">
      <>
        <div className="flex flex-wrap p-3 pt-4 justify-start md:justify-center gap-3 md:gap-6 items-center sticky top-0 bg-white z-[2]">
          <div className="font-bold text-md max-w-full truncate">
            {interviewState?.name || "未命名岗位"}
          </div>

          <div
            className="w-5 h-5 rounded-full border-2 border-white shadow"
            style={{ backgroundColor: iconColor }}
          />

          <div className="flex flex-row gap-3 my-auto">
            <UserIcon className="my-auto" size={16} />: {String(responses?.length)}
          </div>
          <div className="flex flex-row items-center gap-1 text-sm text-slate-500">
            <Clock3 size={15} />
            预计 {interviewState?.time_duration ?? 20} 分钟
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className={
                    "bg-transparent shadow-none relative text-xs text-indigo-600 px-1 h-7 hover:scale-110 hover:bg-transparent"
                  }
                  variant={"secondary"}
                  onClick={(event) => {
                    event.stopPropagation();
                    openSharePopup();
                  }}
                >
                  <Share2 size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="bg-zinc-300" side="bottom" sideOffset={4}>
                <span className="text-black flex flex-row gap-4">分享</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="bg-transparent shadow-none text-xs text-indigo-600 px-0 h-7 hover:scale-110 relative"
                  onClick={(event) => {
                    event.stopPropagation();
                    seeInterviewPreviewPage();
                  }}
                >
                  <Eye />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="bg-zinc-300" side="bottom" sideOffset={4}>
                <span className="text-black flex flex-row gap-4">预览</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="bg-transparent shadow-none text-xs text-indigo-600 px-0 h-7 hover:scale-110 relative"
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowColorPicker(!showColorPicker);
                  }}
                >
                  <Palette size={19} />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="bg-zinc-300" side="bottom" sideOffset={4}>
                <span className="text-black flex flex-row gap-4">主题色</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="bg-transparent shadow-none text-xs text-indigo-600 px-0 h-7 hover:scale-110 relative"
                  onClick={(event) => {
                    event.stopPropagation();
                    router.push(`/interviews/${interviewId}?edit=true`);
                  }}
                >
                  <Pencil size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="bg-zinc-300" side="bottom" sideOffset={4}>
                <span className="text-black flex flex-row gap-4">编辑</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="inline-flex cursor-pointer">
            <span className="ms-3 my-auto text-sm">开放中</span>
            <Switch
              checked={isActive}
              className={`ms-3 my-auto ${isActive ? "bg-indigo-600" : "bg-[#E6E7EB]"}`}
              onCheckedChange={handleToggle}
            />
          </div>
        </div>
        <div className="flex flex-col lg:flex-row w-full min-w-0 p-2 h-auto lg:h-[85%] gap-3">
          <div className="w-full lg:w-[28%] min-w-0 flex flex-col p-2 divide-y-2 rounded-sm border-2 border-slate-100">
            <div className="flex w-full justify-center py-2">
              <Select
                onValueChange={async (newValue: string) => {
                  setFilterStatus(newValue);
                }}
              >
                <SelectTrigger className="w-[95%] bg-slate-100 rounded-lg">
                  <Filter size={18} className=" text-slate-400" />
                  <SelectValue placeholder="筛选方式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CandidateStatus.NO_STATUS}>
                    <div className="flex items-center">
                      <div className="w-3 h-3 bg-gray-400 rounded-full mr-2" />
                      待筛选
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
                  <SelectItem value="ALL">
                    <div className="flex items-center">
                      <div className="w-3 h-3 border-2 border-gray-300 rounded-full mr-2" />
                      全部
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <ScrollArea className="h-auto lg:h-full max-h-[260px] lg:max-h-none p-1 rounded-md border-none">
              {filterResponses().length > 0 ? (
                filterResponses().map((response) => (
                  <button
                    type="button"
                    className={`p-2 rounded-md hover:bg-indigo-100 border-2 my-1 text-left text-xs ${
                      callId === response.call_id ? "bg-indigo-200" : "border-indigo-100"
                    } flex flex-row justify-between cursor-pointer w-full`}
                    key={response?.id}
                    onClick={() => {
                      router.push(`/interviews/${interviewId}?call=${response.call_id}`);
                      handleResponseClick(response);
                    }}
                  >
                    <div className="flex flex-row gap-1 items-center w-full">
                      {response.candidate_status === "NOT_SELECTED" ? (
                        <div className="w-[5%] h-full bg-red-500 rounded-sm" />
                      ) : response.candidate_status === "POTENTIAL" ? (
                        <div className="w-[5%] h-full bg-yellow-500 rounded-sm" />
                      ) : response.candidate_status === "SELECTED" ? (
                        <div className="w-[5%] h-full bg-green-500 rounded-sm" />
                      ) : (
                        <div className="w-[5%] h-full bg-gray-400 rounded-sm" />
                      )}
                      <div className="flex items-center justify-between w-full">
                        <div className="flex flex-col my-auto">
                          <p className="font-medium mb-[2px]">
                            {response?.name ? `${response?.name}的面试记录` : "匿名"}
                          </p>
                          <p className="">
                            {formatTimestampToDateHHMM(String(response?.created_at))}
                          </p>
                        </div>
                        <div className="flex flex-col items-center justify-center ml-auto flex-shrink-0">
                          {!response.is_viewed && (
                            <div className="w-4 h-4 flex items-center justify-center mb-1">
                              <div className="text-indigo-500 text-xl leading-none">●</div>
                            </div>
                          )}
                          <div
                            className={`w-6 h-6 flex items-center justify-center ${
                              response.is_viewed ? "h-full" : ""
                            }`}
                          >
                            {response.analytics &&
                              response.analytics.overallScore !== undefined && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="w-6 h-6 rounded-full bg-white border-2 border-indigo-500 flex items-center justify-center">
                                        <span className="text-indigo-500 text-xs font-semibold">
                                          {response?.analytics?.overallScore}
                                        </span>
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      className="bg-gray-500"
                                      side="bottom"
                                      sideOffset={4}
                                    >
                                      <span className="text-white font-normal flex flex-row gap-4">
                                        综合评分
                                      </span>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <p className="text-center text-gray-500">暂无面试记录</p>
              )}
            </ScrollArea>
          </div>
          <div className="w-full lg:w-[72%] min-w-0 rounded-md">
            {callId ? (
              <CallInfo
                call_id={callId}
                onDeleteResponse={handleDeleteResponse}
                onCandidateStatusChange={handleCandidateStatusChange}
              />
            ) : edit ? (
              <EditInterview interview={interviewState ?? undefined} interviewers={interviewers} />
            ) : (
              <SummaryInfo
                responses={responses}
                interview={interviewState ?? undefined}
                interviewers={interviewers}
              />
            )}
          </div>
        </div>
      </>
      {showColorPicker && (
        <Modal open={true} closeOnOutsideClick={false} onClose={applyColorChange}>
          <div className="w-[250px] p-3">
            <h3 className="text-lg font-semibold mb-4 text-center">选择主题色</h3>
            <ChromePicker
              disableAlpha={true}
              color={themeColor}
              styles={{
                default: {
                  picker: { width: "100%" },
                },
              }}
              onChange={handleColorChange}
            />
          </div>
        </Modal>
      )}
      {isSharePopupOpen && (
        <SharePopup
          open={isSharePopupOpen}
          shareContent={
            interviewState?.readable_slug
              ? `${base_url}/call/${interviewState?.readable_slug}`
              : (interviewState?.url as string)
          }
          onClose={closeSharePopup}
        />
      )}
    </div>
  );
}

export default InterviewDetailView;
