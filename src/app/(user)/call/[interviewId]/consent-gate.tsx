"use client";

import type { Interview } from "@/types/interview";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { primeAudioContext } from "./audio-unlock";
import {
  CONSENT_VERSION,
  type ConsentRecord,
  formatCnDate,
  getPrivacyContactEmail,
  getRetentionMonths,
  retentionDeadline,
} from "./consent";

/**
 * 候选人知情同意页（P3 名下，新建组件）
 *
 * 位置：渲染在 `<Call interview={interview} />` **之前**（页面层）。
 * 理由：P1 的通话组件已声明「内部不涉及合规交互」且接口冻结，P3 不能改它。
 *
 * 合规要点（中国《个人信息保护法》第 14/17/28/29 条）：
 *   · 声音是**敏感个人信息** ⇒ 必须**单独同意**（所以做成独立的勾选项，不与其他内容打包）；
 *   · 必须告知：处理目的、保存期限、谁能看、如何删除；
 *   · AI 自动化初筛 ⇒ 页面明示「AI 仅辅助初筛，最终决定由人工做出」。
 */

type ConsentGateProps = {
  interview: Interview;
  /** 候选人完成同意动作后回调（由页面负责落库/落 localStorage 并放行通话组件） */
  onAgree: (record: ConsentRecord) => void | Promise<void>;
  /** 专属链接用于定位候选人个人数据删除入口。 */
  inviteToken?: string;
};

type CheckItemProps = {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testId: string;
  children: React.ReactNode;
};

function CheckItem({ id, checked, onChange, testId, children }: CheckItemProps) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-indigo-100 bg-white p-3 text-sm font-normal text-gray-800 transition-colors hover:border-indigo-300"
    >
      <input
        id={id}
        data-testid={testId}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[2px] h-5 w-5 shrink-0 accent-indigo-600"
      />
      <span className="leading-relaxed">{children}</span>
    </label>
  );
}

export function ConsentGate({ interview, onAgree, inviteToken }: ConsentGateProps) {
  const [sensitiveAgreed, setSensitiveAgreed] = useState(false);
  const [retentionAgreed, setRetentionAgreed] = useState(false);
  const [optionalImproveAgreed, setOptionalImproveAgreed] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const themeColor = interview.theme_color || "#4F46E5";
  const months = getRetentionMonths();
  const deadlineText = formatCnDate(retentionDeadline(new Date(), months));
  const contactEmail = getPrivacyContactEmail();
  const dataRequestHref = `/call/${encodeURIComponent(
    inviteToken || interview.readable_slug || interview.id,
  )}/data-request`;

  const canAgree = sensitiveAgreed && retentionAgreed;

  const handleAgree = async () => {
    if (!canAgree || isSaving) {
      return;
    }
    setIsSaving(true);
    // iOS Safari：在真实用户手势里预热音频通道（详见 audio-unlock.ts 的说明）
    primeAudioContext();
    try {
      await onAgree({
        version: CONSENT_VERSION,
        interviewId: interview.id,
        interviewName: interview.name ?? "",
        agreedAt: new Date().toISOString(),
        sensitiveDataAgreed: sensitiveAgreed,
        retentionAgreed: retentionAgreed,
        optionalImproveAgreed: optionalImproveAgreed,
        userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (declined) {
    return (
      <div
        data-testid="consent-declined"
        className="mx-auto w-full max-w-[560px] rounded-xl border-2 border-b-4 border-r-4 border-black bg-white p-5 font-normal sm:p-8"
      >
        <h1 className="text-lg font-bold">你已选择暂不同意</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-700">
          没有你的同意，本次面试无法开始，我们也不会记录你的任何回答。这不影响你今后再次应聘本公司的职位。
        </p>
        <p className="mt-3 text-sm leading-relaxed text-gray-700">
          如果你对信息处理方式有疑问，可以联系发送面试邀请的招聘人员
          {contactEmail ? (
            <>
              ，或发邮件至 <span className="font-semibold">{contactEmail}</span>
            </>
          ) : null}
          。你也可以随时在
          <Link className="mx-1 font-semibold text-indigo-600 underline" href={dataRequestHref}>
            「申请删除我的数据」
          </Link>
          页面自助删除。
        </p>
        <button
          type="button"
          data-testid="consent-reconsider"
          onClick={() => setDeclined(false)}
          className="mt-6 h-11 w-full rounded-lg border-2 bg-white text-sm font-semibold"
          style={{ borderColor: themeColor }}
        >
          重新阅读并同意
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="consent-gate"
      className="mx-auto w-full max-w-[640px] rounded-xl border-2 border-b-4 border-r-4 border-black bg-gray-50 p-4 font-normal sm:p-7"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {interview.name}
      </p>
      <h1 className="mt-1 text-xl font-bold leading-snug sm:text-2xl">面试前请阅读并同意</h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-700">
        本次面试由 AI 面试官通过语音与你交流。开始之前，请阅读下面的说明，并分别确认两项同意。
      </p>

      {/* ── 处理内容 ── */}
      <section className="mt-5 rounded-lg border border-indigo-100 bg-white p-4">
        <h2 className="text-sm font-bold text-gray-900">本次面试会记录什么</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-700">
          <li>
            面试过程中，你的语音会<strong>实时上传至国内大模型语音服务</strong>
            （通义实时语音，域名为境内服务）用于实时识别与语音合成。
          </li>
          <li>
            本场专属链接已由招聘人员关联到你的简历，并据此生成了面试问题；面试时，相关岗位与简历背景会用于实时追问。
          </li>
          <li>
            面试结束后，系统会保存：<strong>文字转录稿（逐字稿）</strong>、AI 初筛评分与评语、
            面试时长等过程指标，以及本场专属链接所关联的<strong>姓名、邮箱和简历</strong>。
          </li>
          <li>
            本系统<strong>不保存通话录音音频文件</strong>（不做录音存储），只保存文字与评分结果。
          </li>
        </ul>
      </section>

      {/* ── 敏感个人信息：单独同意 ── */}
      <section className="mt-4 rounded-lg border-2 border-indigo-200 bg-white p-4">
        <h2 className="text-sm font-bold text-gray-900">关于你的声音（敏感个人信息）</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-700">
          按照中国《个人信息保护法》，你的<strong>声音属于敏感个人信息</strong>， 处理它需要取得你的
          <strong>单独同意</strong> —— 所以这一项单独列出来，不与其他内容打包。
          请勾选下面的第一项表示单独同意。
        </p>
      </section>

      {/* ── 保存期限与删除 ── */}
      <section className="mt-4 rounded-lg border border-indigo-100 bg-white p-4">
        <h2 className="text-sm font-bold text-gray-900">保存期限、谁能看、如何删除</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-700">
          <li>
            <strong>保存期限</strong>：{`自面试结束之日起 ${months} 个月`}
            （按今天推算约为 {deadlineText}），到期删除。
          </li>
          <li>
            <strong>谁能看</strong>：仅公司招聘团队成员（HR）可查看，只用于本次招聘的评估环节。
          </li>
          <li>
            <strong>如何删除</strong>：你可以随时在
            <Link className="mx-1 font-semibold text-indigo-600 underline" href={dataRequestHref}>
              「申请删除我的数据」
            </Link>
            页面自助删除自己的转录稿与评分记录。
          </li>
        </ul>
      </section>

      {/* ── AI 透明性 ── */}
      <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-bold text-gray-900">关于 AI 的使用</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-700">
          <strong>AI 仅辅助初筛，最终决定由人工做出。</strong>
          本系统的评分仅用于帮招聘人员快速了解你的回答，不会单独作为拒绝录用的依据；
          正式的录用决定由招聘人员人工复核后作出。
        </p>
      </section>

      {/* ── 同意动作 ── */}
      <div className="mt-5 space-y-3">
        <CheckItem
          id="consent-sensitive"
          testId="consent-check-sensitive"
          checked={sensitiveAgreed}
          onChange={setSensitiveAgreed}
        >
          <span className="font-semibold">我单独同意</span>
          ：我同意为了本次面试，由本系统将我的语音实时上传至国内大模型语音服务进行识别，
          并生成文字转录稿与 AI 初筛评分（我已了解我将不会收到面试录音文件）。
        </CheckItem>

        <CheckItem
          id="consent-retention"
          testId="consent-check-retention"
          checked={retentionAgreed}
          onChange={setRetentionAgreed}
        >
          <span className="font-semibold">我已阅读并知悉</span>
          ：我的转录稿与评分将保存 {months} 个月，仅招聘团队可见，我可以随时申请删除；
          且我已知悉「AI 仅辅助初筛，最终决定由人工做出」。
        </CheckItem>

        <CheckItem
          id="consent-optional"
          testId="consent-check-optional"
          checked={optionalImproveAgreed}
          onChange={setOptionalImproveAgreed}
        >
          <span className="font-semibold">（可选）</span>
          我同意在<strong>去除姓名、邮箱等身份信息后</strong>，将本次面试记录用于改进面试流程。
          不勾选不影响本次面试。
        </CheckItem>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          data-testid="consent-agree"
          disabled={!canAgree || isSaving}
          onClick={() => void handleAgree()}
          className="inline-flex h-12 w-full items-center justify-center rounded-lg text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-2/3"
          style={{ backgroundColor: themeColor }}
        >
          {isSaving ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
          {isSaving ? "正在保存同意记录…" : "同意并开始面试"}
        </button>
        <button
          type="button"
          data-testid="consent-decline"
          onClick={() => setDeclined(true)}
          className="h-12 w-full rounded-lg border-2 bg-white text-base font-semibold text-gray-700 sm:w-1/3"
          style={{ borderColor: themeColor }}
        >
          暂不同意
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-gray-500">
        两处必选项都勾选后才能开始面试。同意文案版本：{CONSENT_VERSION}。
      </p>
    </div>
  );
}
