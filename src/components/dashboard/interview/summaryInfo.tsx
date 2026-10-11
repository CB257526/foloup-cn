"use client";

import DataTable, { type TableData } from "@/components/dashboard/interview/dataTable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CandidateStatus } from "@/lib/enum";
import { convertSecondstoMMSS } from "@/lib/utils";
import type { Interview } from "@/types/interview";
import type { Interviewer } from "@/types/interviewer";
import type { Response } from "@/types/response";
import { PieChart } from "@mui/x-charts/PieChart";
import { Info, StarIcon, UserCircleIcon } from "lucide-react";
import Image from "next/image";
import React, { useEffect, useState } from "react";

type SummaryProps = {
  responses: Response[];
  interview: Interview | undefined;
  /** 由服务端页面查出后传入（原版来自 interviewers.context） */
  interviewers: Interviewer[];
};

function InfoTooltip({ content }: { content: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Info
            className="h-2 w-2 text-[#4F46E5] inline-block ml-0 align-super font-bold"
            strokeWidth={2.5}
          />
        </TooltipTrigger>
        <TooltipContent className="bg-gray-500 text-white font-normal">
          <p>{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SummaryInfo({ responses, interview, interviewers }: SummaryProps) {
  const [interviewer, setInterviewer] = useState<Interviewer>();
  const [totalDuration, setTotalDuration] = useState<number>(0);
  /**
   * 平均综合评分（来自 analytics.overallScore；未评分的记录不计入）。
   * 原版这里是「面试完成率」，数据来自 Retell 的 agent_task_completion_rating ——
   * 换掉 Retell 后该字段已不存在，卡片会恒为 0（缺陷 D-7）。改用我们真实拥有的评分数据。
   */
  const [avgScore, setAvgScore] = useState<number | null>(null);
  /**
   * 评分分布（替代原先依赖 Retell 的「候选人情绪」图 —— 情绪字段同样已不存在）。
   * 分档：优秀 ≥80 / 良好 60–79 / 待提升 <60 / 未评分。
   */
  const [scoreBuckets, setScoreBuckets] = useState({
    excellent: 0,
    good: 0,
    fair: 0,
    none: 0,
  });

  const totalResponses = responses.length;

  const [candidateStatusCount, setCandidateStatusCount] = useState({
    [CandidateStatus.NO_STATUS]: 0,
    [CandidateStatus.NOT_SELECTED]: 0,
    [CandidateStatus.POTENTIAL]: 0,
    [CandidateStatus.SELECTED]: 0,
  });

  const [tableData, setTableData] = useState<TableData[]>([]);

  const prepareTableData = (responses: Response[]): TableData[] => {
    return responses.map((response) => ({
      call_id: response.call_id,
      name: response.name || "匿名",
      overallScore: response.analytics?.overallScore || 0,
      communicationScore: response.analytics?.communication?.score || 0,
      callSummary: response.analytics?.softSkillSummary || "暂无总结",
    }));
  };

  useEffect(() => {
    if (!interviewers || !interview) {
      return;
    }
    const interviewer = interviewers.find(
      (interviewer) => interviewer.id === interview.interviewer_id,
    );
    setInterviewer(interviewer);
  }, [interviewers, interview]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    if (!responses) {
      return;
    }

    const scoreAcc = { sum: 0, count: 0 };
    const scoreBucketCounter = { excellent: 0, good: 0, fair: 0, none: 0 };

    let totalDuration = 0;

    const statusCounter = {
      [CandidateStatus.NO_STATUS]: 0,
      [CandidateStatus.NOT_SELECTED]: 0,
      [CandidateStatus.POTENTIAL]: 0,
      [CandidateStatus.SELECTED]: 0,
    };

    for (const response of responses) {
      // 平均分与评分分布：只用真实存在的 analytics.overallScore（未评分的记入「未评分」档）
      const score = response.analytics?.overallScore;
      if (typeof score === "number" && Number.isFinite(score)) {
        scoreAcc.sum += score;
        scoreAcc.count += 1;
        if (score >= 80) {
          scoreBucketCounter.excellent += 1;
        } else if (score >= 60) {
          scoreBucketCounter.good += 1;
        } else {
          scoreBucketCounter.fair += 1;
        }
      } else {
        scoreBucketCounter.none += 1;
      }

      totalDuration += response.duration;
      if (Object.values(CandidateStatus).includes(response.candidate_status as CandidateStatus)) {
        statusCounter[response.candidate_status as CandidateStatus]++;
      }
    }

    setTotalDuration(totalDuration);
    setAvgScore(scoreAcc.count > 0 ? scoreAcc.sum / scoreAcc.count : null);
    setScoreBuckets(scoreBucketCounter);
    setCandidateStatusCount(statusCounter);

    const preparedData = prepareTableData(responses);
    setTableData(preparedData);
  }, [responses]);

  return (
    <div className="h-screen z-[10] mx-2">
      {responses.length > 0 ? (
        <div className="bg-slate-200 rounded-2xl min-h-[120px] p-2 ">
          <div className="flex flex-row gap-2 justify-between items-center mx-2">
            <div className="flex flex-row gap-2 items-center">
              <p className="font-semibold my-2">整体分析</p>
            </div>
            <p className="text-sm">
              使用的面试官：<span className="font-medium">{interviewer?.name}</span>
            </p>
          </div>
          <p className="my-3 ml-2 text-sm">
            岗位描述：<span className="font-medium">{interview?.description}</span>
          </p>
          <div className="flex flex-col gap-1 my-2 mt-4 mx-2 p-4 rounded-2xl bg-slate-50 shadow-md">
            <ScrollArea className="h-[250px]">
              <DataTable data={tableData} interviewId={interview?.id || ""} />
            </ScrollArea>
          </div>
          <div className="flex flex-row gap-1 my-2 justify-center">
            <div className="flex flex-col">
              <div className="flex flex-col gap-1 my-2 mt-4 mx-2 p-3 rounded-2xl bg-slate-50 shadow-md max-w-[400px]">
                <div className="flex flex-row items-center justify-center gap-1 font-semibold mb-1 text-[15px]">
                  平均时长
                  <InfoTooltip content="用户完成一次面试的平均用时" />
                </div>
                <div className="flex items-center justify-center">
                  <p className="text-2xl font-semibold text-indigo-600 w-fit p-1 px-2 bg-indigo-100 rounded-md">
                    {convertSecondstoMMSS(totalDuration / responses.length)}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-center justify-center gap-1 mx-2 p-3 rounded-2xl bg-slate-50 shadow-md max-w-[360px]">
                <div className="flex flex-row gap-1 font-semibold mb-1 text-[15px] mx-auto text-center">
                  平均综合评分
                  <InfoTooltip content="所有已评分面试记录的综合评分平均值（满分 100）" />
                </div>
                <p className="w-fit text-2xl font-semibold text-indigo-600  p-1 px-2 bg-indigo-100 rounded-md">
                  {avgScore === null ? "暂无评分" : Math.round(avgScore)}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-1 my-2 mt-4 mx-2 p-4 rounded-2xl bg-slate-50 shadow-md max-w-[360px]">
              <div className="flex flex-row gap-2 text-[15px] font-bold mb-3 mx-auto">
                <StarIcon />
                评分分布
                <InfoTooltip content="按综合评分分档：优秀 ≥80 / 良好 60-79 / 待提升 <60 / 未评分" />
              </div>
              <PieChart
                sx={{
                  "& .MuiChartsLegend-series text": {
                    fontSize: "0.8rem !important",
                  },
                }}
                series={[
                  {
                    data: [
                      {
                        id: 0,
                        value: scoreBuckets.excellent,
                        label: `优秀 (${scoreBuckets.excellent})`,
                        color: "#22c55e",
                      },
                      {
                        id: 1,
                        value: scoreBuckets.good,
                        label: `良好 (${scoreBuckets.good})`,
                        color: "#eab308",
                      },
                      {
                        id: 2,
                        value: scoreBuckets.fair,
                        label: `待提升 (${scoreBuckets.fair})`,
                        color: "#eb4444",
                      },
                      {
                        id: 3,
                        value: scoreBuckets.none,
                        label: `未评分 (${scoreBuckets.none})`,
                        color: "#9ca3af",
                      },
                    ],
                    highlightScope: { faded: "global", highlighted: "item" },
                    faded: {
                      innerRadius: 10,
                      additionalRadius: -10,
                      color: "gray",
                    },
                  },
                ]}
                width={360}
                height={120}
              />
            </div>
            <div className="flex flex-col gap-1 my-2 mt-4 mx-2 p-4 rounded-2xl bg-slate-50 shadow-md">
              <div className="flex flex-row gap-2 text-[15px] font-bold mx-auto mb-1">
                <UserCircleIcon />
                候选人状态
                <InfoTooltip content="候选人筛选状态分布" />
              </div>
              <div className="text-sm text-center mb-1">面试记录总数：{totalResponses}</div>
              <PieChart
                sx={{
                  "& .MuiChartsLegend-series text": {
                    fontSize: "0.8rem !important",
                  },
                }}
                series={[
                  {
                    data: [
                      {
                        id: 0,
                        value: candidateStatusCount[CandidateStatus.SELECTED],
                        label: `已选中 (${candidateStatusCount[CandidateStatus.SELECTED]})`,
                        color: "#22c55e",
                      },
                      {
                        id: 1,
                        value: candidateStatusCount[CandidateStatus.POTENTIAL],
                        label: `潜力人选 (${candidateStatusCount[CandidateStatus.POTENTIAL]})`,
                        color: "#eab308",
                      },
                      {
                        id: 2,
                        value: candidateStatusCount[CandidateStatus.NOT_SELECTED],
                        label: `未选中 (${candidateStatusCount[CandidateStatus.NOT_SELECTED]})`,
                        color: "#eb4444",
                      },
                      {
                        id: 3,
                        value: candidateStatusCount[CandidateStatus.NO_STATUS],
                        label: `待筛选 (${candidateStatusCount[CandidateStatus.NO_STATUS]})`,
                        color: "#9ca3af",
                      },
                    ],
                    highlightScope: { faded: "global", highlighted: "item" },
                    faded: {
                      innerRadius: 10,
                      additionalRadius: -10,
                      color: "gray",
                    },
                  },
                ]}
                width={360}
                height={120}
                slotProps={{
                  legend: {
                    direction: "column",
                    position: { vertical: "middle", horizontal: "right" },
                    padding: 0,
                    itemMarkWidth: 10,
                    itemMarkHeight: 10,
                    markGap: 5,
                    itemGap: 5,
                  },
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="w-[85%] h-[60%] flex flex-col items-center justify-center">
          <div className="flex flex-col items-center">
            <Image src="/No-Responses.png" alt="暂无面试记录" width={270} height={270} />
            <p className="text-center text-sm mt-0">请分享给目标候选人</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default SummaryInfo;
