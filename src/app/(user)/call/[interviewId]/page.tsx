"use client";

import Call from "@/components/call";
import LoaderWithText from "@/components/loaders/loader-with-text/loaderWithText";
import { InterviewService } from "@/services/interviews.service";
import type { Interview } from "@/types/interview";
import { ArrowUpRightSquareIcon } from "lucide-react";
import Image from "next/image";
import { use, useEffect, useState } from "react";
import { primeAudioOnFirstGesture } from "./audio-unlock";
import { ConsentGate } from "./consent-gate";
import { type ConsentRecord, readConsent, saveConsent } from "./consent";
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
  const [isActive, setIsActive] = useState(true);
  const [interviewNotFound, setInterviewNotFound] = useState(false);
  const [consentState, setConsentState] = useState<ConsentState>("unknown");
  useEffect(() => {
    if (interview) {
      setIsActive(interview?.is_active === true);
    }
  }, [interview]);

  useEffect(() => {
    const fetchinterview = async () => {
      try {
        const response = await InterviewService.getInterviewById(interviewId);
        if (response) {
          setInterview(response);
          document.title = response.name;
        } else {
          setInterviewNotFound(true);
        }
      } catch (error) {
        console.error(error);
        setInterviewNotFound(true);
      }
    };

    fetchinterview();
  }, [interviewId]);

  // 同意状态只能在客户端读（localStorage），所以放在 effect 里，避免服务端/客户端水合不一致。
  useEffect(() => {
    if (!interview?.id) {
      return;
    }
    setConsentState(readConsent(interview.id) ? "given" : "missing");
  }, [interview?.id]);

  // iOS Safari 音频解锁：候选人第一次触摸页面时就预热音频通道（详见 audio-unlock.ts）
  useEffect(() => primeAudioOnFirstGesture(), []);

  const handleAgree = (record: ConsentRecord) => {
    saveConsent(record);
    setConsentState("given");
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
        ) : !isActive ? (
          <PopUpMessage
            title="面试暂不可用"
            description="我们目前暂不接收面试记录，请联系发送方了解详情。"
            image="/closed.png"
          />
        ) : consentState === "unknown" ? (
          <PopupLoader />
        ) : consentState === "missing" ? (
          // 合规要求：同意动作必须在通话开始**之前**完成（P1 的通话组件内部不涉及合规交互）
          <ConsentGate interview={interview} onAgree={handleAgree} />
        ) : (
          // 手机端与桌面端走同一条渲染路径（原版在手机上是「请用电脑」的拒绝块，已按要求删除）
          <div className="candidate-call-shell">
            <Call interview={interview} />
          </div>
        )}
      </div>
    </div>
  );
}

export default InterviewInterface;
