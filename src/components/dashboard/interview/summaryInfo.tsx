"use client";

import DataTable, { type TableData } from "@/components/dashboard/interview/dataTable";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CandidateStatus } from "@/lib/enum";
import { convertSecondstoMMSS } from "@/lib/utils";
import type { Interview } from "@/types/interview";
import type { Interviewer } from "@/types/interviewer";
import type { CompetencyScore, Response } from "@/types/response";
import { Info, StarIcon, UserCircleIcon } from "lucide-react";
import Image from "next/image";
import { type ReactNode, useMemo } from "react";

type SummaryProps = {
  responses: Response[];
  interview: Interview | undefined;
  interviewers: Interviewer[];
};

type DistributionRow = {
  label: string;
  count: number;
  color: string;
};

function InfoTooltip({ content }: { content: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={content}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-indigo-500 hover:bg-indigo-50"
          >
            <Info size={14} strokeWidth={2.5} />
          </button>
        </TooltipTrigger>
        <TooltipContent className="bg-slate-800 text-white">
          <p>{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function MetricCard({ title, value, help }: { title: string; value: string; help: string }) {
  return (
    <section className="flex min-w-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-1">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-600">{title}</h3>
        <InfoTooltip content={help} />
      </div>
      <p className="mt-4 truncate text-2xl font-semibold tracking-tight text-indigo-600">{value}</p>
    </section>
  );
}

function DistributionCard({
  title,
  help,
  icon,
  rows,
  total,
}: {
  title: string;
  help: string;
  icon: ReactNode;
  rows: DistributionRow[];
  total: number;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 xl:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-slate-700">{icon}</span>
          <h3 className="truncate text-sm font-semibold text-slate-800">{title}</h3>
        </div>
        <InfoTooltip content={help} />
      </div>
      <p className="mt-1 text-xs text-slate-500">共 {total} 位候选人</p>
      <div className="mt-4 space-y-3">
        {rows.map((row) => {
          const percent = total > 0 ? Math.max(0, Math.min(100, (row.count / total) * 100)) : 0;
          return (
            <div
              key={row.label}
              className="grid grid-cols-[minmax(92px,0.85fr)_minmax(0,1.6fr)_36px] items-center gap-2"
            >
              <span className="truncate text-xs text-slate-600 sm:text-sm">{row.label}</span>
              <div
                role="progressbar"
                tabIndex={0}
                aria-label={`${row.label}占比`}
                aria-valuemin={0}
                aria-valuemax={total || 1}
                aria-valuenow={row.count}
                className="h-2.5 overflow-hidden rounded-full bg-slate-100"
              >
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${percent}%`, backgroundColor: row.color }}
                />
              </div>
              <span className="text-right text-xs font-semibold tabular-nums text-slate-700">
                {row.count}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SummaryInfo({ responses, interview, interviewers }: SummaryProps) {
  const interviewer = useMemo(
    () => interviewers.find((item) => item.id === interview?.interviewer_id),
    [interviewers, interview?.interviewer_id],
  );

  const metrics = useMemo(() => {
    const scoreBuckets = { excellent: 0, good: 0, fair: 0, none: 0 };
    const statusCounts: Record<CandidateStatus, number> = {
      [CandidateStatus.NO_STATUS]: 0,
      [CandidateStatus.NOT_SELECTED]: 0,
      [CandidateStatus.POTENTIAL]: 0,
      [CandidateStatus.SELECTED]: 0,
    };
    let totalDuration = 0;
    let scoreTotal = 0;
    let scoredCount = 0;

    for (const response of responses) {
      totalDuration += response.server_duration ?? response.duration ?? 0;
      const score = response.analytics?.overallScore;
      if (typeof score === "number" && Number.isFinite(score)) {
        scoreTotal += score;
        scoredCount += 1;
        if (score >= 80) {
          scoreBuckets.excellent += 1;
        } else if (score >= 60) {
          scoreBuckets.good += 1;
        } else {
          scoreBuckets.fair += 1;
        }
      } else {
        scoreBuckets.none += 1;
      }

      const status = Object.values(CandidateStatus).includes(
        response.candidate_status as CandidateStatus,
      )
        ? (response.candidate_status as CandidateStatus)
        : CandidateStatus.NO_STATUS;
      statusCounts[status] += 1;
    }

    const tableData: TableData[] = responses.map((response) => {
      // 只消费已落库的结构化能力分；旧评分没有该字段时留空数组，表格显示「暂无能力分」。
      const rawScores = response.analytics?.competencyScores;
      const competencyScores = Array.isArray(rawScores)
        ? rawScores
            .map((item: CompetencyScore) => ({
              name: typeof item?.name === "string" ? item.name : "",
              score:
                typeof item?.score === "number" && Number.isFinite(item.score) ? item.score : null,
            }))
            .filter((item) => item.name)
        : [];

      return {
        call_id: response.call_id,
        name: response.name || "匿名",
        overallScore: response.analytics?.overallScore || 0,
        communicationScore: response.analytics?.communication?.score || 0,
        callSummary: response.analytics?.softSkillSummary || "暂无总结",
        competencyScores,
      };
    });

    return {
      totalDuration,
      averageDuration: responses.length ? totalDuration / responses.length : 0,
      averageScore: scoredCount ? Math.round(scoreTotal / scoredCount) : null,
      scoreBuckets,
      statusCounts,
      tableData,
    };
  }, [responses]);

  if (responses.length === 0) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
        <Image src="/No-Responses.png" alt="暂无面试记录" width={220} height={220} />
        <p className="mt-2 text-sm font-medium text-slate-700">完成面试后，结果会显示在这里</p>
        <p className="mt-1 text-xs text-slate-500">候选人问题和链接请从岗位候选人工作台创建。</p>
      </div>
    );
  }

  const scoreRows: DistributionRow[] = [
    { label: "优秀（≥80）", count: metrics.scoreBuckets.excellent, color: "#16a34a" },
    { label: "良好（60–79）", count: metrics.scoreBuckets.good, color: "#eab308" },
    { label: "待提升（<60）", count: metrics.scoreBuckets.fair, color: "#ef4444" },
    { label: "未评分", count: metrics.scoreBuckets.none, color: "#94a3b8" },
  ];
  const statusRows: DistributionRow[] = [
    { label: "已选中", count: metrics.statusCounts[CandidateStatus.SELECTED], color: "#16a34a" },
    { label: "潜力人选", count: metrics.statusCounts[CandidateStatus.POTENTIAL], color: "#eab308" },
    {
      label: "未选中",
      count: metrics.statusCounts[CandidateStatus.NOT_SELECTED],
      color: "#ef4444",
    },
    { label: "待筛选", count: metrics.statusCounts[CandidateStatus.NO_STATUS], color: "#94a3b8" },
  ];

  return (
    <div className="min-w-0 space-y-4 pb-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">面试结果概览</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              岗位描述：{interview?.description || interview?.objective || "未填写岗位描述"}
            </p>
          </div>
          <p className="shrink-0 text-sm text-slate-500">
            AI 面试官：
            <span className="font-medium text-slate-700">{interviewer?.name || "未指定"}</span>
          </p>
        </div>
        <div className="mt-4 max-h-[360px] min-w-0 overflow-auto rounded-xl border border-slate-100 bg-slate-50 p-2 sm:p-3">
          <DataTable data={metrics.tableData} interviewId={interview?.id || ""} />
        </div>
      </section>

      {/* 统计采用响应式横向条形图，避免固定宽度 SVG 在窄卡片中互相挤压。 */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          title="平均面试时长"
          value={convertSecondstoMMSS(metrics.averageDuration)}
          help="所有已完成面试记录的平均用时，优先采用服务端记录时长。"
        />
        <MetricCard
          title="平均综合评分"
          value={metrics.averageScore === null ? "暂无评分" : `${metrics.averageScore} 分`}
          help="只统计已经生成 AI 综合评分的候选人，满分 100 分。"
        />
        <DistributionCard
          title="评分分布"
          help="按候选人的 AI 综合评分分档；尚未完成评分的记录单独统计。"
          icon={<StarIcon size={18} />}
          rows={scoreRows}
          total={responses.length}
        />
        <DistributionCard
          title="候选人筛选状态"
          help="按 HR 设置的候选人状态统计，尚未筛选的记录计入待筛选。"
          icon={<UserCircleIcon size={18} />}
          rows={statusRows}
          total={responses.length}
        />
      </div>
    </div>
  );
}

export default SummaryInfo;
