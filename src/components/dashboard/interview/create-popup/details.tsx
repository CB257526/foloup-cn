"use client";

import { createInterviewAction } from "@/app/actions/interviews";
import CompetencyDimensionEditor from "@/components/dashboard/interview/competencyDimensionEditor";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_INTERVIEW_DURATION_MINUTES,
  MAX_INTERVIEW_DURATION_MINUTES,
} from "@/lib/constants";
import type { InterviewBase } from "@/types/interview";
import { DEFAULT_COMPETENCY_DIMENSIONS, normalizeCompetencyDimensions } from "@/types/interview";
import type { Interviewer } from "@/types/interviewer";
import type { CompetencyDimension } from "@/types/response";
import { Briefcase, Clock3, Loader2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  setOpen: (open: boolean) => void;
  interviewers: Interviewer[];
  defaultDuration?: number;
}

/** 创建可复用的岗位模板；简历和专属题目会在岗位保存后按候选人分别添加。 */
function DetailsPopup({ open, setOpen, interviewers, defaultDuration }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [description, setDescription] = useState("");
  const [selectedInterviewer, setSelectedInterviewer] = useState<number>(interviewers[0]?.id ?? 0);
  const [questionCount, setQuestionCount] = useState(5);
  const [duration, setDuration] = useState(defaultDuration ?? DEFAULT_INTERVIEW_DURATION_MINUTES);
  // 能力维度默认给出初筛常用的五项，HR 可增删改排序；保存前不会写库。
  const [dimensions, setDimensions] = useState<CompetencyDimension[]>(
    DEFAULT_COMPETENCY_DIMENSIONS,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      return;
    }
    setName("");
    setObjective("");
    setDescription("");
    setSelectedInterviewer(interviewers[0]?.id ?? 0);
    setQuestionCount(5);
    setDuration(defaultDuration ?? DEFAULT_INTERVIEW_DURATION_MINUTES);
    setDimensions(DEFAULT_COMPETENCY_DIMENSIONS);
    setSaving(false);
  }, [open, defaultDuration, interviewers]);

  const handleCreate = async () => {
    if (!name.trim() || !objective.trim() || !selectedInterviewer) {
      return;
    }
    // 至少保留一个带名称的能力维度，否则评分结果没有可解释的分项依据。
    const normalizedDimensions = normalizeCompetencyDimensions(dimensions);
    if (normalizedDimensions.length === 0) {
      toast.error("请至少填写一个能力维度名称", {
        description: "AI 评分会按这些维度逐项打分并给出候选人原话证据。",
      });

      return;
    }
    setSaving(true);
    try {
      const created = (await createInterviewAction({
        name: name.trim(),
        objective: objective.trim(),
        description: description.trim() || objective.trim(),
        interviewer_id: selectedInterviewer,
        question_count: questionCount,
        time_duration: String(duration),
        is_anonymous: false,
        questions: [],
        response_count: 0,
        logo_url: "",
        competency_dimensions: normalizedDimensions,
      })) as { id?: string } | null;

      if (!created?.id) {
        throw new Error("岗位模板保存失败，请重试");
      }
      toast.success("岗位模板已创建", {
        description: "接下来可逐位添加候选人并生成专属面试链接。",
      });
      setOpen(false);
      // 只 push，不要再紧跟着 refresh：这两者在同一个事件循环里发出时，
      // refresh 会把尚未完成的 push 顶掉 —— 岗位确实已落库，但页面停在 /dashboard，
      // HR 会以为"没创建成功"。目标页是 force-dynamic，push 过去自然会拿到最新数据。
      router.push(`/interviews/${created.id}`);
    } catch (error) {
      toast.error("创建岗位失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-[min(92vw,44rem)] max-h-[88vh] overflow-y-auto px-1 text-slate-900">
      <div className="flex items-start gap-3 border-b border-slate-100 pb-4 pr-8">
        <div className="mt-1 rounded-xl bg-indigo-50 p-2.5 text-indigo-600">
          <Briefcase size={22} />
        </div>
        <div>
          <h1 className="text-xl font-semibold">创建岗位模板</h1>
          <p className="mt-1 text-sm text-slate-500">
            岗位要求只需填写一次；候选人简历和专属问题之后单独管理。
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium sm:col-span-2">
          岗位名称 <span className="text-rose-500">*</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：AI 应用开发工程师"
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 font-normal outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        <div className="text-sm font-medium sm:col-span-2">
          <p>
            岗位要求（PD）/ 面试目标 <span className="text-rose-500">*</span>
          </p>
          <Textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="填写岗位职责、必备技能、经验要求和面试重点。之后添加每位候选人时，AI 会结合该候选人的简历生成个性化问题。"
            className="mt-1.5 min-h-32 resize-y rounded-lg border-slate-300 font-normal focus-visible:ring-indigo-200"
          />
        </div>

        <div className="text-sm font-medium sm:col-span-2">
          <p>候选人看到的岗位介绍</p>
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="可选；留空时使用岗位要求的简短版本。"
            className="mt-1.5 min-h-20 resize-y rounded-lg border-slate-300 font-normal focus-visible:ring-indigo-200"
          />
        </div>

        <label className="text-sm font-medium sm:col-span-2">
          AI 面试官
          <select
            value={selectedInterviewer}
            onChange={(event) => setSelectedInterviewer(Number(event.target.value))}
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            {interviewers.length === 0 && <option value={0}>暂时没有可用的 AI 面试官</option>}
            {interviewers.map((interviewer) => (
              <option value={interviewer.id} key={interviewer.id}>
                {interviewer.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium">
          专属问题数量
          <input
            type="number"
            min={1}
            max={12}
            value={questionCount}
            onChange={(event) =>
              setQuestionCount(Math.max(1, Math.min(12, Number(event.target.value) || 1)))
            }
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        <label className="text-sm font-medium">
          面试时长（分钟）
          <span className="mt-1.5 flex h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-slate-500">
            <Clock3 size={16} />
            <input
              type="number"
              min={1}
              max={MAX_INTERVIEW_DURATION_MINUTES}
              value={duration}
              onChange={(event) =>
                setDuration(
                  Math.max(
                    1,
                    Math.min(MAX_INTERVIEW_DURATION_MINUTES, Number(event.target.value) || 1),
                  ),
                )
              }
              className="w-full bg-transparent font-normal text-slate-900 outline-none"
            />
          </span>
        </label>
      </div>

      <div className="mt-5">
        <CompetencyDimensionEditor
          dimensions={dimensions}
          onChange={setDimensions}
          disabled={saving}
        />
      </div>

      <div className="mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>
          取消
        </Button>
        <Button
          className="bg-indigo-600 hover:bg-indigo-700"
          disabled={
            saving ||
            !name.trim() ||
            !objective.trim() ||
            !selectedInterviewer ||
            interviewers.length === 0
          }
          onClick={handleCreate}
        >
          {saving ? <Loader2 className="mr-2 animate-spin" size={16} /> : null}
          保存岗位并添加候选人
        </Button>
      </div>
    </div>
  );
}

export default DetailsPopup;
