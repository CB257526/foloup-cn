"use client";

import { parsePdf } from "@/actions/parse-pdf";
import Modal from "@/components/dashboard/Modal";
import QuestionCard from "@/components/dashboard/interview/create-popup/questionCard";
import ExportButton from "@/components/dashboard/interview/exportButton";
import SummaryInfo from "@/components/dashboard/interview/summaryInfo";
import { Button } from "@/components/ui/button";
import type { CandidateInviteListItem } from "@/lib/data/candidates";
import { CandidateService } from "@/services/candidates.service";
import type { Interview, Question } from "@/types/interview";
import type { Interviewer } from "@/types/interviewer";
import type { Response } from "@/types/response";
import axios from "axios";
import {
  Check,
  Clipboard,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  interview: Interview;
  invites: CandidateInviteListItem[];
  responses: Response[];
  interviewers: Interviewer[];
}

type GeneratedQuestions = {
  questions: Array<{ question: string }>;
  description: string;
};

const STATUS_TEXT: Record<CandidateInviteListItem["status"], string> = {
  ready: "未使用",
  in_progress: "面试中",
  completed: "已完成",
  revoked: "已撤销",
};

const STATUS_STYLE: Record<CandidateInviteListItem["status"], string> = {
  ready: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  in_progress: "bg-amber-50 text-amber-700 ring-amber-200",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  revoked: "bg-slate-100 text-slate-500 ring-slate-200",
};

function CandidateManager({ interview, invites, responses, interviewers }: Props) {
  const router = useRouter();
  const [activeView, setActiveView] = useState<"candidates" | "overview">("candidates");
  const [isAdding, setIsAdding] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [resumeFileName, setResumeFileName] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [candidateDescription, setCandidateDescription] = useState("");
  const [editingQuestions, setEditingQuestions] = useState(false);
  const [isReadingResume, setIsReadingResume] = useState(false);
  const [expandedInvite, setExpandedInvite] = useState<string | null>(null);
  const [fullResume, setFullResume] = useState("");
  const [resumeLoading, setResumeLoading] = useState(false);

  const resetForm = () => {
    setCandidateName("");
    setCandidateEmail("");
    setResumeFileName("");
    setResumeText("");
    setQuestions([]);
    setCandidateDescription("");
    setEditingQuestions(false);
    setIsGenerating(false);
    setIsSaving(false);
    setIsReadingResume(false);
  };

  const closeAddDialog = () => {
    setIsAdding(false);
    resetForm();
  };

  const handleResumeUpload = async (file?: File) => {
    if (!file) {
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("目前支持 PDF 格式的简历");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("简历文件不能超过 10MB");
      return;
    }

    setIsReadingResume(true);
    setResumeFileName(file.name);
    setResumeText("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await parsePdf(formData);
      if (!result.success || !result.text?.trim()) {
        throw new Error(result.error || "没有从 PDF 中读取到文字，请确认文件不是扫描图片");
      }
      if (result.text.length > 50000) {
        throw new Error("简历正文过长，请先压缩为 50,000 字符以内的 PDF");
      }
      setResumeText(result.text.trim());
      toast.success("简历已读取", { description: "简历原文件不会公开给候选人链接访问者。" });
    } catch (error) {
      setResumeFileName("");
      toast.error("无法读取简历", {
        description: error instanceof Error ? error.message : "请检查 PDF 后重试。",
      });
    } finally {
      setIsReadingResume(false);
    }
  };

  const handleGenerateQuestions = async () => {
    if (!resumeText.trim()) {
      toast.error("请先上传候选人 PDF 简历");
      return;
    }
    setIsGenerating(true);
    try {
      const response = await axios.post("/api/generate-interview-questions", {
        name: interview.name,
        objective: interview.objective,
        number: interview.question_count || 5,
        context: `岗位描述：${interview.description || "未填写"}\n候选人简历：\n${resumeText}`,
      });
      const generated = JSON.parse(response.data.response) as GeneratedQuestions;
      if (!Array.isArray(generated.questions) || generated.questions.length === 0) {
        throw new Error("AI 没有生成有效问题，请重试");
      }
      setQuestions(
        generated.questions.map((item, index) => ({
          id: `${Date.now()}-${index}`,
          question: String(item.question || "").trim(),
          follow_up_count: 2,
        })),
      );
      setCandidateDescription(String(generated.description || ""));
      setEditingQuestions(true);
      toast.success("候选人专属问题已生成", {
        description: "请检查并调整问题后，再创建该候选人的唯一链接。",
      });
    } catch (error) {
      toast.error("生成面试问题失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleQuestionChange = (id: string, changed: Question) => {
    setQuestions((current) => current.map((question) => (question.id === id ? changed : question)));
  };

  const handleSaveInvite = async () => {
    const normalizedEmail = candidateEmail.trim().toLowerCase();
    if (!candidateName.trim() || !normalizedEmail || !resumeText.trim()) {
      toast.error("请补全姓名、邮箱并上传简历");
      return;
    }
    if (questions.length === 0 || questions.some((question) => !question.question.trim())) {
      toast.error("请确保每道专属问题都已填写");
      return;
    }

    setIsSaving(true);
    try {
      const invite = await CandidateService.createInvite({
        interviewId: interview.id,
        name: candidateName.trim(),
        email: normalizedEmail,
        resumeFileName,
        resumeText,
        candidateDescription,
        questions,
      });
      try {
        await navigator.clipboard.writeText(
          `${window.location.origin}/call/${invite.invite_token}`,
        );
        toast.success("专属面试链接已创建并复制", {
          description: "该链接只对应这位候选人，可从候选人清单再次复制。",
        });
      } catch {
        toast.success("专属面试链接已创建", { description: "请在候选人清单中复制该链接。" });
      }
      closeAddDialog();
      router.refresh();
    } catch (error) {
      toast.error("创建候选人链接失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
      setIsSaving(false);
    }
  };

  const handleCopyInvite = async (token: string) => {
    const url = `${window.location.origin}/call/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("专属面试链接已复制", {
        description: "该链接只对应当前候选人，请勿转发给其他人。",
      });
    } catch {
      toast.error("复制失败", { description: "请检查浏览器剪贴板权限后重试。" });
    }
  };

  const handleToggleResume = async (inviteId: string) => {
    if (expandedInvite === inviteId) {
      setExpandedInvite(null);
      setFullResume("");
      return;
    }
    setExpandedInvite(inviteId);
    setResumeLoading(true);
    try {
      const record = await CandidateService.getInviteById(inviteId, interview.id);
      setFullResume(record?.resume_text || "简历内容暂时不可用，请检查本机简历加密密钥。");
    } catch (error) {
      toast.error("读取简历失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
      setFullResume("");
    } finally {
      setResumeLoading(false);
    }
  };

  const handleRevoke = async (invite: CandidateInviteListItem) => {
    if (!window.confirm(`确定撤销 ${invite.name} 的未使用面试链接吗？`)) {
      return;
    }
    try {
      const revoked = await CandidateService.revokeInvite(invite.id, interview.id);
      if (!revoked) {
        throw new Error("当前链接状态不允许撤销");
      }
      toast.success("候选人链接已撤销");
      if (expandedInvite === invite.id) {
        setExpandedInvite(null);
      }
      router.refresh();
    } catch (error) {
      toast.error("撤销失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    }
  };

  const statusCount = invites.reduce(
    (counts, invite) => {
      counts[invite.status] += 1;
      return counts;
    },
    { ready: 0, in_progress: 0, completed: 0, revoked: 0 },
  );

  return (
    <div className="mx-2 min-w-0 pb-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-indigo-600">岗位候选人工作台</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">{interview.name}</h2>
            <p className="mt-2 max-w-4xl whitespace-pre-wrap text-sm leading-6 text-slate-600">
              {interview.objective || interview.description || "尚未填写岗位要求。"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {/* 导出的是本岗位真实候选人的评分与状态，不含简历全文/密钥/专属链接令牌。 */}
            <ExportButton interviewId={interview.id} disabled={invites.length === 0} />
            <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={() => setIsAdding(true)}>
              <Plus size={17} className="mr-2" /> 添加候选人
            </Button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatusSummary label="全部候选人" value={invites.length} color="slate" />
          <StatusSummary label="未使用" value={statusCount.ready} color="indigo" />
          <StatusSummary label="面试中" value={statusCount.in_progress} color="amber" />
          <StatusSummary label="已完成" value={statusCount.completed} color="emerald" />
        </div>
      </section>

      <div className="mt-5 flex gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveView("candidates")}
          className={`border-b-2 px-4 py-2.5 text-sm font-medium transition ${activeView === "candidates" ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <UsersRound size={16} className="mr-2 inline" />
          候选人和专属链接
        </button>
        <button
          type="button"
          onClick={() => setActiveView("overview")}
          className={`border-b-2 px-4 py-2.5 text-sm font-medium transition ${activeView === "overview" ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          面试概览
        </button>
      </div>

      {activeView === "overview" ? (
        <div className="mt-4">
          <SummaryInfo responses={responses} interview={interview} interviewers={interviewers} />
        </div>
      ) : invites.length === 0 ? (
        <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
          <div className="rounded-2xl bg-indigo-50 p-4 text-indigo-600">
            <UserRound size={28} />
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-900">还没有添加候选人</h3>
          <p className="mt-1 max-w-lg text-sm leading-6 text-slate-500">
            上传第一位候选人的 PDF 简历，AI 会结合“{interview.name}
            ”岗位要求生成专属问题。确认后再创建只属于此人的面试链接。
          </p>
          <Button
            className="mt-4 bg-indigo-600 hover:bg-indigo-700"
            onClick={() => setIsAdding(true)}
          >
            <Plus size={17} className="mr-2" />
            添加第一位候选人
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {invites.map((invite) => (
            <article
              key={invite.id}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 rounded-xl bg-slate-100 p-2.5 text-slate-600">
                    <UserRound size={19} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{invite.name}</h3>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[invite.status]}`}
                      >
                        {STATUS_TEXT[invite.status]}
                      </span>
                      {invite.is_analysed && (
                        <span className="text-xs text-emerald-700">评分已生成</span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-600">{invite.email}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <FileText size={13} />
                      {invite.resume_file_name}
                      {invite.response_duration !== null && (
                        <span>· 面试 {formatSeconds(invite.response_duration)}</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {invite.status === "ready" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleCopyInvite(invite.invite_token)}
                    >
                      <Clipboard size={15} className="mr-1.5" />
                      复制专属链接
                    </Button>
                  )}
                  {invite.call_id && invite.status === "completed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        router.push(`/interviews/${interview.id}?call=${invite.call_id}`)
                      }
                    >
                      查看面试结果
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleToggleResume(invite.id)}
                  >
                    {expandedInvite === invite.id ? "收起候选人资料" : "查看候选人资料"}
                  </Button>
                  {invite.status === "ready" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600 hover:text-rose-700"
                      onClick={() => void handleRevoke(invite)}
                    >
                      撤销链接
                    </Button>
                  )}
                </div>
              </div>
              {expandedInvite === invite.id && (
                <div className="border-t border-slate-100 bg-slate-50 p-4 sm:p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <ShieldCheck size={16} className="text-indigo-600" />
                    候选人简历（仅本岗位 HR 工作台可查看）
                  </div>
                  <p className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
                    {resumeLoading ? "正在读取加密简历…" : fullResume || "没有可显示的简历正文。"}
                  </p>
                  {invite.call_id && (
                    <p className="mt-2 text-xs text-slate-500">面试会话编号：{invite.call_id}</p>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {isAdding && (
        <Modal open={isAdding} closeOnOutsideClick={!isSaving} onClose={closeAddDialog}>
          <div className="max-h-[86vh] w-[min(94vw,58rem)] overflow-y-auto px-1 text-slate-900">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4 pr-8">
              <div>
                <p className="text-sm font-medium text-indigo-600">{interview.name}</p>
                <h2 className="mt-1 text-xl font-semibold">添加候选人并生成专属面试</h2>
                <p className="mt-1 text-sm text-slate-500">
                  个人简历只与本位候选人的题目、链接和面试记录关联。
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-medium">
                候选人姓名
                <input
                  value={candidateName}
                  onChange={(event) => setCandidateName(event.target.value)}
                  placeholder="填写简历对应的候选人姓名"
                  className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </label>
              <label className="text-sm font-medium">
                候选人邮箱
                <input
                  type="email"
                  value={candidateEmail}
                  onChange={(event) => setCandidateEmail(event.target.value)}
                  placeholder="name@company.com"
                  className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </label>
            </div>

            {!editingQuestions && (
              <div className="mt-4 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 p-4">
                <div className="block text-sm font-semibold text-slate-800">
                  上传候选人 PDF 简历
                  <span className="mt-1 block font-normal text-slate-500">
                    文件不超过 10MB。系统提取必要文字后加密保存，不向候选人链接公开简历正文。
                  </span>
                </div>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={isReadingResume || isGenerating}
                  onChange={(event) => void handleResumeUpload(event.target.files?.[0])}
                  className="mt-3 block w-full rounded-lg border border-slate-200 bg-white p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700"
                />
                {isReadingResume && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-indigo-700">
                    <Loader2 size={15} className="animate-spin" />
                    正在安全读取简历内容…
                  </p>
                )}
                {resumeText && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-emerald-700">
                    <Check size={15} />
                    {resumeFileName} 已读取，共 {resumeText.length.toLocaleString()} 个字符
                  </p>
                )}
              </div>
            )}

            {editingQuestions && (
              <div className="mt-5 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="font-semibold">检查候选人专属问题</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      题目由岗位要求和该候选人简历共同生成；修改完成后才会签发链接。
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setEditingQuestions(false)}>
                    <RefreshCw size={14} className="mr-1.5" />
                    返回资料
                  </Button>
                </div>
                {questions.map((question, index) => (
                  <QuestionCard
                    key={question.id}
                    questionNumber={index + 1}
                    questionData={question}
                    onQuestionChange={handleQuestionChange}
                    onDelete={(id) =>
                      setQuestions((current) => current.filter((item) => item.id !== id))
                    }
                  />
                ))}
                <Button
                  variant="outline"
                  onClick={() =>
                    setQuestions((current) => [
                      ...current,
                      { id: `${Date.now()}`, question: "", follow_up_count: 2 },
                    ])
                  }
                >
                  <Plus size={16} className="mr-2" />
                  添加问题
                </Button>
                <label className="block text-sm font-medium">
                  候选人面试说明
                  <textarea
                    value={candidateDescription}
                    onChange={(event) => setCandidateDescription(event.target.value)}
                    rows={3}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 p-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
              </div>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                disabled={isGenerating || isSaving}
                onClick={closeAddDialog}
              >
                取消
              </Button>
              {!editingQuestions ? (
                <Button
                  className="bg-indigo-600 hover:bg-indigo-700"
                  disabled={
                    isGenerating ||
                    isReadingResume ||
                    !resumeText ||
                    !candidateName.trim() ||
                    !isValidEmail(candidateEmail)
                  }
                  onClick={() => void handleGenerateQuestions()}
                >
                  {isGenerating ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
                  {isGenerating ? "正在结合简历出题…" : "生成候选人专属问题"}
                </Button>
              ) : (
                <Button
                  className="bg-indigo-600 hover:bg-indigo-700"
                  disabled={
                    isSaving ||
                    questions.length === 0 ||
                    questions.some((question) => !question.question.trim())
                  }
                  onClick={() => void handleSaveInvite()}
                >
                  {isSaving ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
                  创建专属面试链接
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StatusSummary({
  label,
  value,
  color,
}: { label: string; value: number; color: "slate" | "indigo" | "amber" | "emerald" }) {
  const colors = {
    slate: "bg-slate-50 text-slate-800",
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-700",
    emerald: "bg-emerald-50 text-emerald-700",
  };
  return (
    <div className={`rounded-xl px-3 py-3 ${colors[color]}`}>
      <p className="text-xs font-medium opacity-75">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function formatSeconds(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

export default CandidateManager;
