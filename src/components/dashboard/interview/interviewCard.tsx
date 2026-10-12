"use client";

import MiniLoader from "@/components/loaders/mini-loader/miniLoader";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { CandidateService } from "@/services/candidates.service";
import { InterviewerService } from "@/services/interviewers.service";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

interface Props {
  name: string | null;
  interviewerId: number;
  id: string;
  url: string;
  readableSlug: string;
}

/** 岗位卡片只进入 HR 管理页，不再错误地把岗位模板当成某位候选人的面试链接。 */
function InterviewCard({ name, interviewerId, id }: Props) {
  const [completedCount, setCompletedCount] = useState<number | null>(null);
  const [candidateCount, setCandidateCount] = useState<number | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [interviewerImage, setInterviewerImage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      InterviewerService.getInterviewer(interviewerId),
      CandidateService.getInvites(id),
    ])
      .then(([interviewer, invites]) => {
        if (cancelled) {
          return;
        }
        setInterviewerImage(interviewer?.image ?? "");
        setCandidateCount(invites.length);
        setCompletedCount(invites.filter((invite) => invite.status === "completed").length);
      })
      .catch((error) => {
        console.error("读取岗位候选人数失败：", error);
        if (!cancelled) {
          setCandidateCount(0);
          setCompletedCount(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, interviewerId]);

  return (
    <Link
      href={`/interviews/${id}`}
      className="ml-1 mr-3 mt-4 block w-56 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <Card className="relative h-60 overflow-hidden rounded-xl shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        <CardContent className="p-0">
          <div className="flex h-36 items-center justify-center bg-indigo-600 px-4 text-center">
            <CardTitle className="text-lg text-white">{name || "未命名岗位"}</CardTitle>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-slate-100">
              <Image
                src={interviewerImage || "/user-icon.png"}
                alt="AI 面试官头像"
                width={48}
                height={48}
                className="h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.src = "/user-icon.png";
                }}
              />
            </div>
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium text-slate-800">候选人</p>
              {candidateCount === null ? (
                <div className="mt-1">
                  <MiniLoader />
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500">
                  {candidateCount} 位候选人 · {completedCount ?? 0} 场已完成
                </p>
              )}
            </div>
          </div>
          <div className="absolute bottom-0 right-0 rounded-tl-lg bg-slate-50 px-3 py-1.5 text-xs font-medium text-indigo-700">
            进入岗位工作台 →
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default InterviewCard;
