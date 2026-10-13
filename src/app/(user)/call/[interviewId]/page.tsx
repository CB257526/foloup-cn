"use client";

import Call from "@/components/call";
import LoaderWithText from "@/components/loaders/loader-with-text/loaderWithText";
import { CandidateService } from "@/services/candidates.service";
import { InterviewService } from "@/services/interviews.service";
import type { ConsentPolicy, PublicCandidateInvite } from "@/types/candidate";
import type { Interview } from "@/types/interview";
import { ArrowUpRightSquareIcon } from "lucide-react";
import Image from "next/image";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { primeAudioOnFirstGesture } from "./audio-unlock";
import { type ConsentRecord, readConsent, saveConsent } from "./consent";
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
 *   unknown —— 还在等服务端下发同意策略 / 读本地便利记录（等客户端挂载，避免水合不一致）
 *   given   —— 该岗位的**当前文案版本**已同意过，直接放行
 *   missing —— 需要先走同意环节
 */
type ConsentState = "unknown" | "given" | "missing";

/** 渲染「第 N 步 / 共 M 步」的步骤标签（与同意门里的样式保持一致） */
function StepBadge({ step, total, title }: { step: number; total: number; title: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-indigo-600 px-2 text-xs font-bold text-white">
        第 {step} 步 / 共 {total} 步
      </span>
      <h2 className="min-w-0 break-words text-sm font-bold text-slate-900">{title}</h2>
    </div>
  );
}

function InterviewInterface({ params }: Props) {
  const resolvedParams = use(params);
  const interviewId = decodeParam(resolvedParams.interviewId);
  const [interview, setInterview] = useState<Interview>();
  const [candidate, setCandidate] = useState<PublicCandidateInvite | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [interviewNotFound, setInterviewNotFound] = useState(false);
  const [consentState, setConsentState] = useState<ConsentState>("unknown");
  const [consentPolicy, setConsentPolicy] = useState<ConsentPolicy | null>(null);
  const [policyFailed, setPolicyFailed] = useState(false);

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
        const response = await InterviewService.getInterviewById(targetInterviewId);
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

  /**
   * 同意策略（文案版本 + 留存月数）由服务端下发。
   * 版本号不再写在客户端里 —— 否则文案一改版，浏览器还拿着旧版本号，
   * 会把「旧版本的同意」当成「新版本的同意」放行。
   */
  useEffect(() => {
    let cancelled = false;

    const loadPolicy = async (attempt: number): Promise<void> => {
      try {
        const policy = await CandidateService.getConsentPolicy();
        if (!cancelled) {
          setConsentPolicy(policy);
          setPolicyFailed(false);
        }
      } catch (error) {
        console.error("读取同意策略失败：", error);
        if (cancelled) {
          return;
        }
        if (attempt < 2) {
          // 只读接口，重试一次基本能覆盖瞬时抖动；仍失败就要明确告诉候选人刷新
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (!cancelled) {
            await loadPolicy(attempt + 1);
          }
          return;
        }
        setPolicyFailed(true);
      }
    };

    void loadPolicy(1);
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 判断「当前文案版本是否已同意」：
   *   候选人专属链接 —— **只认服务端记录**（`candidate_invite.consent_version === 当前版本`）。
   *                     ⚠️ 这里刻意**不读 localStorage**：localStorage 是候选人自己就能改写的
   *                     本地缓存，拿它放行等于让候选人自开绿灯。页面的判断只是"少读一遍说明"的
   *                     体验优化，真正的授权由服务端在签发语音凭据 / 正式开始面试时各自再核一次。
   *   历史岗位公共链接 —— 没有候选人可关联，服务端无法留痕，保持原有本地记录行为（向后兼容）。
   */
  useEffect(() => {
    const version = consentPolicy?.version;
    if (!interview?.id || !version) {
      return;
    }
    if (candidate) {
      setConsentState(candidate.consent_version === version ? "given" : "missing");
      return;
    }
    setConsentState(readConsent(interview.id, undefined, version) ? "given" : "missing");
  }, [interview?.id, candidate, consentPolicy?.version]);

  // iOS Safari 音频解锁：候选人第一次触摸页面时就预热音频通道（详见 audio-unlock.ts）
  useEffect(() => primeAudioOnFirstGesture(), []);

  /**
   * 提交同意留痕。
   * ⚠️ 失败时**必须抛出**：同意门据此保持在原地、显示"不会进入面试"并给出重试按钮。
   *    这里吞掉异常会让候选人以为同意成功、直接进入面试，而服务端其实没有审计证据。
   */
  const handleAgree = async (record: ConsentRecord) => {
    if (!interview) {
      throw new Error("岗位信息缺失，请刷新页面后重试");
    }
    try {
      if (candidate) {
        // 候选人专属链接：服务端留痕是**唯一**依据，必须写成功才放行
        await CandidateService.recordConsent({
          // 只提交专属令牌：候选人身份、岗位、user-agent 摘要全部由服务端解析
          token: interviewId,
          consentVersion: record.version,
          voiceProcessingAccepted: record.voiceProcessingAccepted,
          evaluationAccepted: record.evaluationAccepted,
          improvementAccepted: record.improvementAccepted,
        });
        // 不再写 localStorage：候选人链接的同意状态只由服务端记录决定，
        // 写了也不会被读取（避免留下"本地缓存能授权"的误导性实现）。
      } else {
        // 历史公共岗位链接：服务端没有候选人可关联，仍用本地缓存做便利记录（向后兼容）
        saveConsent(record);
      }
      setConsentState("given");
    } catch (error) {
      console.error("保存候选人同意记录失败：", error);
      toast.error("暂时无法保存同意记录", { description: "请检查网络后重试，再开始面试。" });
      throw error;
    }
  };

  const totalSteps = candidate ? 4 : 3;

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
        ) : policyFailed ? (
          <PopUpMessage
            title="页面暂时加载失败"
            description="无法读取面试须知，请检查网络后刷新页面重试；如多次失败，请联系发送面试邀请的招聘人员。"
            image="/invalid-url.png"
          />
        ) : consentState === "unknown" || !consentPolicy ? (
          <PopupLoader />
        ) : (
          <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-4">
            {/* ══════════ 第 1 步：身份与岗位确认 ══════════ */}
            {candidate && (
              <section className="min-w-0 rounded-xl border border-indigo-100 bg-white p-4 shadow-sm sm:p-6">
                <StepBadge step={1} total={totalSteps} title="确认你的信息与岗位" />
                <h1 className="mt-3 break-words text-xl font-semibold text-slate-900">
                  {candidate.name}
                </h1>
                <p className="mt-1 break-words text-sm text-slate-600">{candidate.email}</p>
                <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="min-w-0 rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-medium text-slate-500">本场岗位</p>
                    <p className="mt-1 break-words text-sm font-semibold text-slate-800">
                      {interview.name}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-medium text-slate-500">已准备的简历</p>
                    <p className="mt-1 flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800">
                      <span aria-hidden="true">📄</span>
                      <span className="break-words">{candidate.resume_file_name}</span>
                    </p>
                  </div>
                </div>
                {candidate.candidate_description && (
                  <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                    {candidate.candidate_description}
                  </p>
                )}
                <p className="mt-3 break-words text-xs text-slate-500">
                  这条链接仅属于你；页面不会展示其他候选人的资料。如果不是你本人，请勿继续。
                </p>
              </section>
            )}

            {consentState === "missing" ? (
              <ConsentGate
                interview={interview}
                consentVersion={consentPolicy.version}
                retentionMonths={consentPolicy.retentionMonths}
                startStep={candidate ? 2 : 1}
                totalSteps={totalSteps}
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
