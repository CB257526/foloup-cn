"use client";

import Call from "@/components/call";
import LoaderWithText from "@/components/loaders/loader-with-text/loaderWithText";
import { CandidateService } from "@/services/candidates.service";
import { InterviewService } from "@/services/interviews.service";
import type { PublicCandidateInvite } from "@/types/candidate";
import type { Interview } from "@/types/interview";
import { ArrowUpRightSquareIcon } from "lucide-react";
import Image from "next/image";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { primeAudioOnFirstGesture } from "./audio-unlock";
import { type ConsentRecord, readConsent, saveConsent } from "./consent";
import { createConsentRecordAction } from "@/app/actions/call-sessions";
import { ConsentGate } from "./consent-gate";
import "./candidate-shell.css";

type Props = {
  params: Promise<{
    interviewId: string;
  }>;
};

type PopupProps = {
  title: string;
  description: string;
  image: string;
};

function PopupLoader() {
  return (
    <div className="bg-white rounded-md absolute -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2 md:w-[80%] w-[90%]">
      <div className="h-[88vh] justify-center items-center rounded-lg border-2 border-b-4 border-r-4 border-black font-bold transition-all md:block dark:border-white">
        <div className="relative flex flex-col items-center justify-center h-full">
          <LoaderWithText />
        </div>
      </div>
      <a
        className="flex flex-row justify-center align-middle mt-3"
        href="https://folo-up.co/"
        target="_blank"
        rel="noopener noreferrer"
      >
        <div className="text-center text-md font-semibold mr-2">
          由 FoloUp 提供{" "}
          <span className="font-bold">
            Folo<span className="text-indigo-600">Up</span>
          </span>
        </div>
        <ArrowUpRightSquareIcon className="h-[1.5rem] w-[1.5rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-indigo-500" />
      </a>
    </div>
  );
}

function PopUpMessage({ title, description, image }: PopupProps) {
  return (
    <div className="bg-white rounded-md absolute -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2 md:w-[80%] w-[90%]">
      <div className="h-[88vh] content-center rounded-lg border-2 border-b-4 border-r-4 border-black font-bold transition-all  md:block dark:border-white ">
        <div className="flex flex-col items-center justify-center my-auto">
          <Image src={image} alt="图示" width={200} height={200} className="mb-4" />
          <h1 className="text-md font-medium mb-2">{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <a
        className="flex flex-row justify-center align-middle mt-3"
        href="https://folo-up.co/"
        target="_blank"
        rel="noopener noreferrer"
      >
        <div className="text-center text-md font-semibold mr-2">
          由 FoloUp 提供{" "}
          <span className="font-bold">
            Folo<span className="text-indigo-600">Up</span>
          </span>
        </div>
        <ArrowUpRightSquareIcon className="h-[1.5rem] w-[1.5rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-indigo-500" />
      </a>
    </div>
  );
}

/**
 * 路径参数可能仍是「百分号编码」态（中文岗位名的 readable_slug 必然要编码），
 * 这里安全解码一次再拿去查库。
 *
 * ⚠️ 修的是缺陷 D-1：不解码时 `/call/中文岗位名-xxx` 会查不到岗位，
 * 页面显示 "Invalid URL"。ASCII 岗位名不需编码所以一直没暴露。
 * 详见 验收/P0-验收记录.md 第三节。
 */
function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // 参数里含非法转义序列时保持原样，避免抛错把整页打挂
    return value;
  }
}

/**
 * 「同意状态」三态：
 *   unknown —— 还没读 localStorage（等客户端挂载，避免水合不一致）
 *   given   —— 本设备已同意过该岗位，直接放行
 *   missing —— 需要先走同意环节
 */
type ConsentState = "unknown" | "given" | "missing";

function InterviewInterface({ params }: Props) {
  const resolvedParams = use(params);
  const interviewId = decodeParam(resolvedParams.interviewId);
  const [interview, setInterview] = useState<Interview>();
  const [candidate, setCandidate] = useState<PublicCandidateInvite | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [interviewNotFound, setInterviewNotFound] = useState(false);
  const [consentState, setConsentState] = useState<ConsentState>("unknown");
  useEffect(() => {
    if (interview) {
      setIsActive(interview?.is_active === true);
    }
  }, [interview]);

  useEffect(() => {
    let cancelled = false;
    const loadInterviewTarget = async () => {
      try {
        // 优先按候选人随机令牌查专属邀请；不匹配时才按历史岗位链接兼容读取。
        const invite = await CandidateService.getPublicInviteByToken(interviewId);
        const targetInterviewId = invite?.interview_id ?? interviewId;
        const response = await InterviewService.getPublicInterviewById(targetInterviewId);
        if (cancelled) {
          return;
        }
        if (invite) {
          setCandidate(invite);
        }
        if (response) {
          setInterview(response);
          document.title = invite ? `${invite.name} - ${response.name}` : response.name;
        } else {
          setInterviewNotFound(true);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setInterviewNotFound(true);
        }
      }
    };

    void loadInterviewTarget();
    return () => {
      cancelled = true;
    };
  }, [interviewId]);

  // 同意状态只能在客户端读（localStorage），所以放在 effect 里，避免服务端/客户端水合不一致。
  useEffect(() => {
    if (!interview?.id) {
      return;
    }
    setConsentState(readConsent(interview.id, candidate?.id) ? "given" : "missing");
  }, [interview?.id, candidate?.id]);

  // iOS Safari 音频解锁：候选人第一次触摸页面时就预热音频通道（详见 audio-unlock.ts）
  useEffect(() => primeAudioOnFirstGesture(), []);

  const handleAgree = async (record: ConsentRecord) => {
    if (!interview) {
      return;
    }
    try {
      if (candidate) {
        await CandidateService.recordConsent({
          id: candidate.id,
          interviewId: interview.id,
          consentVersion: record.version,
          voiceProcessingAccepted: record.sensitiveDataAgreed,
          evaluationAccepted: record.retentionAgreed,
          cameraMonitoringAccepted: record.cameraMonitoringAccepted,
          improvementAccepted: record.optionalImproveAgreed,
          userAgent: record.userAgent,
        });
      } else {
        await createConsentRecordAction({
          interviewId: interview.id,
          consentVersion: record.version,
          voiceProcessingAccepted: record.sensitiveDataAgreed,
          evaluationAccepted: record.retentionAgreed,
          cameraMonitoringAccepted: record.cameraMonitoringAccepted,
          improvementAccepted: record.optionalImproveAgreed,
          userAgent: record.userAgent,
        });
      }
      saveConsent(record, candidate?.id);
      setConsentState("given");
    } catch (error) {
      console.error("保存候选人同意记录失败：", error);
      toast.error("暂时无法保存同意记录", { description: "请检查网络后重试，再开始面试。" });
    }
  };

  return (
    <div className="candidate-shell">
      <div className="p-3 sm:p-5 md:p-8 mx-auto form-container">
        {!interview ? (
          interviewNotFound ? (
            <PopUpMessage
              title="无效的链接"
              description="您尝试访问的面试链接无效，请检查链接后重试。"
              image="/invalid-url.png"
            />
          ) : (
            <PopupLoader />
          )
        ) : !candidate && interview.questions.length === 0 ? (
          <PopUpMessage
            title="这是岗位模板"
            description="岗位模板不能直接用于面试。请联系招聘人员，为你创建并发送个人专属面试链接。"
            image="/invalid-url.png"
          />
        ) : candidate?.status === "revoked" || candidate?.revoked_at ? (
          <PopUpMessage
            title="面试链接已撤销"
            description="该候选人专属链接已失效，请联系人力资源获取新的面试安排。"
            image="/closed.png"
          />
        ) : candidate?.status === "in_progress" ? (
          <PopUpMessage
            title="面试已开始"
            description="该专属链接对应的面试已经开始，为避免重复创建记录，请继续使用原页面；如页面意外关闭，请联系人力资源协助恢复。"
            image="/closed.png"
          />
        ) : candidate?.status === "completed" ? (
          <PopUpMessage
            title="本次面试已完成"
            description="该专属链接已完成过面试。如需补充安排，请联系人力资源。"
            image="/closed.png"
          />
        ) : !isActive ? (
          <PopUpMessage
            title="面试暂不可用"
            description="我们目前暂不接收面试记录，请联系发送方了解详情。"
            image="/closed.png"
          />
        ) : consentState === "unknown" ? (
          <PopupLoader />
        ) : (
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
            {candidate && (
              <section className="rounded-xl border border-indigo-100 bg-white p-4 shadow-sm sm:p-6">
                <p className="text-xs font-semibold tracking-wide text-indigo-600">
                  候选人专属面试
                </p>
                <h1 className="mt-1 text-xl font-semibold text-slate-900">{candidate.name}</h1>
                <p className="mt-1 text-sm text-slate-600">{candidate.email}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-medium text-slate-500">本场岗位</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{interview.name}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-medium text-slate-500">已准备的简历</p>
                    <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <span aria-hidden="true">📄</span>
                      {candidate.resume_file_name}
                    </p>
                  </div>
                </div>
                {candidate.candidate_description && (
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                    {candidate.candidate_description}
                  </p>
                )}
                <p className="mt-3 text-xs text-slate-500">
                  这条链接仅属于你；页面不会展示其他候选人的资料。
                </p>
              </section>
            )}
            {consentState === "missing" ? (
              <ConsentGate
                interview={interview}
                onAgree={handleAgree}
                inviteToken={candidate ? interviewId : undefined}
              />
            ) : (
              <div className="candidate-call-shell">
                <Call
                  interview={interview}
                  candidate={candidate ? { ...candidate, token: interviewId } : undefined}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default InterviewInterface;
