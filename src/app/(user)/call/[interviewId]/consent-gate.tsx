"use client";

import type { Interview } from "@/types/interview";
import { AlertTriangle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { primeAudioContext } from "./audio-unlock";
import {
  type ConsentRecord,
  formatCnDate,
  getPrivacyContactEmail,
  retentionDeadline,
} from "./consent";
import { DeviceCheck, type DeviceCheckResult } from "./device-check";

/**
 * 候选人开始流程（同意门）—— P3 新建、P2 后续任务按「连续四步」重构。
 *
 * 位置：渲染在 `<Call interview={interview} />` **之前**（页面层）。
 * 理由：P1 的通话组件已声明「内部不涉及合规交互」且接口冻结，不能改它。
 *
 * 流程顺序（本次改造的重点：让候选人**连续**看到自己在哪一步）：
 *   第 1 步 身份/岗位信息确认  —— 由页面层渲染（候选人姓名、邮箱、岗位、简历文件名）
 *   第 2 步 隐私与 AI 初筛说明 —— 本组件
 *   第 3 步 设备检查           —— 本组件（<DeviceCheck />）
 *   第 4 步 必选同意 → 开始面试 —— 本组件
 *
 * 开始按钮的启用条件是**两个条件同时成立**：设备检查通过 + 两项必选同意都勾选。
 * 任何一项不满足，按钮禁用并在按钮下方写明"还差什么、该做什么"。
 *
 * 合规要点（中国《个人信息保护法》第 14/17/28/29 条）：
 *   · 声音是**敏感个人信息** ⇒ 必须**单独同意**（独立勾选项，不与其他内容打包）；
 *   · 必须告知：处理目的、保存期限、谁能看、如何删除；
 *   · AI 自动化初筛 ⇒ 明示「AI 仅辅助初筛，最终决定由人工做出」；
 *   · 同意必须留痕在**服务端**（由页面通过专属令牌提交），localStorage 只是本地便利。
 *
 * 文案版本：由服务端下发（`consentVersion`），不再由客户端各写一份常量。
 * 版本变化 ⇒ 必须重新确认（旧版本的同意不能当新版本用）。
 */

type ConsentGateProps = {
  interview: Interview;
  /** 服务端下发的当前同意文案版本 */
  consentVersion: string;
  /** 留存期限（自然月，服务端下发，与清理脚本用同一来源） */
  retentionMonths: number;
  /** 本组件从第几步开始（候选人专属链接为 2；历史岗位链接没有身份确认，为 1） */
  startStep: number;
  /** 流程总步数（候选人 4 步 / 历史岗位链接 3 步） */
  totalSteps: number;
  /** 候选人完成同意动作后回调（由页面负责落库并放行通话组件）；失败时应当抛出 */
  onAgree: (record: ConsentRecord) => void | Promise<void>;
  /** 专属链接用于定位候选人个人数据删除入口 */
  inviteToken?: string;
};

type CheckItemProps = {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testId: string;
  disabled?: boolean;
  children: React.ReactNode;
};

function CheckItem({ id, checked, onChange, testId, disabled, children }: CheckItemProps) {
  return (
    <label
      htmlFor={id}
      className={`flex items-start gap-3 rounded-lg border-2 border-indigo-100 bg-white p-3 text-sm font-normal text-gray-800 transition-colors ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-indigo-300"
      }`}
    >
      <input
        id={id}
        data-testid={testId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[2px] h-5 w-5 shrink-0 accent-indigo-600"
      />
      <span className="min-w-0 leading-relaxed">{children}</span>
    </label>
  );
}

function StepBadge({ step, total, title }: { step: number; total: number; title: string }) {
  return (
    <div className="mt-6 flex min-w-0 items-center gap-2">
      <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-indigo-600 px-2 text-xs font-bold text-white">
        第 {step} 步 / 共 {total} 步
      </span>
      <h2 className="min-w-0 break-words text-sm font-bold text-gray-900">{title}</h2>
    </div>
  );
}

export function ConsentGate({
  interview,
  consentVersion,
  retentionMonths,
  startStep,
  totalSteps,
  onAgree,
  inviteToken,
}: ConsentGateProps) {
  /* ① 单独同意：语音（敏感个人信息）—— 必选 */
  const [voiceAgreed, setVoiceAgreed] = useState(false);
  /* ② AI 转录与初筛评分 + 已阅读留存期限/可见范围/删除方式 —— 必选 */
  const [evaluationAgreed, setEvaluationAgreed] = useState(false);
  /* ③ 可选：去标识化后用于流程改进 */
  const [optionalImproveAgreed, setOptionalImproveAgreed] = useState(false);

  const [declined, setDeclined] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deviceGate, setDeviceGate] = useState<DeviceCheckResult>({
    ready: false,
    blockedReason: "",
  });

  const themeColor = interview.theme_color || "#4F46E5";
  const months = retentionMonths;
  const deadlineText = formatCnDate(retentionDeadline(new Date(), months));
  const contactEmail = getPrivacyContactEmail();
  const dataRequestHref = `/call/${encodeURIComponent(
    inviteToken || interview.readable_slug || interview.id,
  )}/data-request`;

  const consentsGiven = voiceAgreed && evaluationAgreed;
  const canStart = consentsGiven && deviceGate.ready && !isSaving;

  /** 按钮禁用时告诉候选人"还差什么" —— 不允许只显示不能点 */
  const blockReason = !deviceGate.ready
    ? deviceGate.blockedReason || "请先完成第 3 步的设备检查，并通过后才开始面试。"
    : !consentsGiven
      ? "请先勾选上面两项必选同意。"
      : "";

  const handleAgree = async () => {
    if (!canStart) {
      return;
    }
    setIsSaving(true);
    setSaveError("");
    // iOS Safari：在真实用户手势里预热音频通道（详见 audio-unlock.ts 的说明）
    primeAudioContext();

    const record: ConsentRecord = {
      version: consentVersion,
      interviewId: interview.id,
      interviewName: interview.name ?? "",
      agreedAt: new Date().toISOString(),
      voiceProcessingAccepted: voiceAgreed,
      evaluationAccepted: evaluationAgreed,
      improvementAccepted: optionalImproveAgreed,
    };

    try {
      await onAgree(record);
    } catch (error) {
      // 同意留痕没写成功 ⇒ 绝不能进入正式面试（页面会保持在同意门并给出重试）
      setSaveError(
        error instanceof Error && error.message
          ? error.message
          : "暂时无法保存同意记录，请检查网络后重试。",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (declined) {
    return (
      <div
        data-testid="consent-declined"
        className="mx-auto w-full max-w-[560px] min-w-0 rounded-xl border-2 border-b-4 border-r-4 border-black bg-white p-5 font-normal sm:p-8"
      >
        <h1 className="text-lg font-bold">你已选择暂不同意</h1>
        <p className="mt-3 break-words text-sm leading-relaxed text-gray-700">
          没有你的同意，本次面试无法开始，我们也不会记录你的任何回答。这不影响你今后再次应聘本公司的职位。
        </p>
        <p className="mt-3 break-words text-sm leading-relaxed text-gray-700">
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
      className="mx-auto w-full max-w-[680px] min-w-0 rounded-xl border-2 border-b-4 border-r-4 border-black bg-gray-50 p-4 font-normal sm:p-7"
    >
      <p className="break-words text-xs font-semibold uppercase tracking-wide text-gray-500">
        {interview.name}
      </p>
      <h1 className="mt-1 break-words text-xl font-bold leading-snug sm:text-2xl">
        面试前请阅读并同意
      </h1>
      <p className="mt-3 break-words text-sm leading-relaxed text-gray-700">
        本次面试由 AI 面试官通过语音与你交流。下面共 {totalSteps} 步，请按顺序完成；
        <strong>最后一步的两项必选同意都勾选、且设备检查通过后，才能开始面试</strong>。
      </p>

      {/* ══════════ 第 2 步：隐私与 AI 初筛说明 ══════════ */}
      <StepBadge step={startStep} total={totalSteps} title="隐私与 AI 初筛说明" />

      {/* ── 处理内容 ── */}
      <section className="mt-3 min-w-0 rounded-lg border border-indigo-100 bg-white p-4">
        <h3 className="text-sm font-bold text-gray-900">本次面试会记录什么</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-700">
          <li className="break-words">
            面试过程中，你的语音会<strong>实时上传至国内大模型语音服务</strong>
            （通义实时语音，域名为境内服务）用于实时识别与语音合成。
          </li>
          <li className="break-words">
            本场专属链接已由招聘人员关联到你的简历，并据此生成了面试问题；面试时，相关岗位与简历背景会用于实时追问。
          </li>
          <li className="break-words">
            面试结束后，系统会保存：<strong>文字转录稿（逐字稿）</strong>、AI 初筛评分与评语、
            面试时长等过程指标，以及本场专属链接所关联的<strong>姓名、邮箱和简历</strong>。
          </li>
          <li className="break-words">
            本系统<strong>不保存通话录音音频文件</strong>（不做录音存储），只保存文字与评分结果。
          </li>
        </ul>
      </section>

      {/* ── 敏感个人信息：单独同意 ── */}
      <section className="mt-3 min-w-0 rounded-lg border-2 border-indigo-200 bg-white p-4">
        <h3 className="text-sm font-bold text-gray-900">关于你的声音（敏感个人信息）</h3>
        <p className="mt-2 break-words text-sm leading-relaxed text-gray-700">
          按照中国《个人信息保护法》，你的<strong>声音属于敏感个人信息</strong>， 处理它需要取得你的
          <strong>单独同意</strong> —— 所以这一项单独列出来，不与其他内容打包。
          请勾选下面第一项表示单独同意。
        </p>
      </section>

      {/* ── 保存期限与删除 ── */}
      <section className="mt-3 min-w-0 rounded-lg border border-indigo-100 bg-white p-4">
        <h3 className="text-sm font-bold text-gray-900">保存期限、谁能看、如何删除</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-700">
          <li className="break-words">
            <strong>保存期限</strong>：{`自面试结束之日起 ${months} 个月`}
            （按今天推算约为 {deadlineText}）。期限届满后，本公司会按内部流程清理这批记录 ——
            <strong>具体何时执行由公司统一安排</strong>。你可以随时自助删除，不必等到期。
          </li>
          <li className="break-words">
            <strong>谁能看</strong>：仅公司招聘团队成员（HR）可查看，只用于本次招聘的评估环节。
          </li>
          <li className="break-words">
            <strong>如何删除</strong>：你可以随时在
            <Link className="mx-1 font-semibold text-indigo-600 underline" href={dataRequestHref}>
              「申请删除我的数据」
            </Link>
            页面自助删除自己的转录稿与评分记录。
          </li>
        </ul>
      </section>

      {/* ── AI 透明性 ── */}
      <section className="mt-3 min-w-0 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h3 className="text-sm font-bold text-gray-900">关于 AI 的使用</h3>
        <p className="mt-2 break-words text-sm leading-relaxed text-gray-700">
          <strong>AI 仅辅助初筛，最终决定由人工做出。</strong>
          本系统的评分仅用于帮招聘人员快速了解你的回答，不会单独作为拒绝录用的依据；
          正式的录用决定由招聘人员人工复核后作出。
        </p>
      </section>

      {/* ══════════ 第 3 步：设备检查 ══════════ */}
      <StepBadge step={startStep + 1} total={totalSteps} title="设备检查" />
      <DeviceCheck onResultChange={setDeviceGate} />

      {/* ══════════ 第 4 步：确认同意并开始面试 ══════════ */}
      <StepBadge step={startStep + 2} total={totalSteps} title="确认同意并开始面试" />

      <div className="mt-3 space-y-3">
        <CheckItem
          id="consent-sensitive"
          testId="consent-check-sensitive"
          checked={voiceAgreed}
          onChange={setVoiceAgreed}
        >
          <span className="font-semibold">我单独同意</span>
          ：我同意为了本次面试，由本系统将我的语音实时上传至国内大模型语音服务进行识别，
          并生成文字转录稿与 AI 初筛评分（我已了解我将不会收到面试录音文件）。
        </CheckItem>

        {/*
          ⚠️ data-testid 仍沿用 consent-check-retention（历史回归脚本在用），
             但语义已对齐为「AI 评估 + 留存知悉」，与库里的 evaluation_accepted 一一对应。
        */}
        <CheckItem
          id="consent-retention"
          testId="consent-check-retention"
          checked={evaluationAgreed}
          onChange={setEvaluationAgreed}
        >
          <span className="font-semibold">我已阅读并知悉</span>
          ：我同意系统基于我的回答生成 AI 初筛评分与评语，且我已知悉 —— 转录稿与评分保存 {months}{" "}
          个月、仅招聘团队可见、我可以随时申请删除， 以及「AI 仅辅助初筛，最终决定由人工做出」。
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

      {saveError && (
        <div
          data-testid="consent-save-error"
          className="mt-4 flex min-w-0 items-start gap-2 rounded-lg border-2 border-red-300 bg-red-50 p-3 text-sm leading-relaxed text-red-800"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span className="break-words">
            同意记录没有保存成功，因此<strong>不会进入面试</strong>：{saveError}
            （请检查网络后，点下面的按钮重试。）
          </span>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          data-testid="consent-agree"
          disabled={!canStart}
          onClick={() => void handleAgree()}
          className="inline-flex h-12 w-full items-center justify-center rounded-lg text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-2/3"
          style={{ backgroundColor: themeColor }}
        >
          {isSaving ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
          {isSaving ? "正在保存同意记录…" : saveError ? "重试并开始面试" : "同意并开始面试"}
        </button>
        <button
          type="button"
          data-testid="consent-decline"
          disabled={isSaving}
          onClick={() => setDeclined(true)}
          className="h-12 w-full rounded-lg border-2 bg-white text-base font-semibold text-gray-700 sm:w-1/3"
          style={{ borderColor: themeColor }}
        >
          暂不同意
        </button>
      </div>

      {!canStart && blockReason && (
        <p
          data-testid="consent-blocked-reason"
          className="mt-3 break-words rounded-md bg-gray-100 p-3 text-sm leading-relaxed text-gray-700"
        >
          还不能开始：{blockReason}
        </p>
      )}

      <p className="mt-3 break-words text-xs leading-relaxed text-gray-500">
        两项必选都勾选、且设备检查通过后才能开始面试。同意文案版本：{consentVersion}
        （版本更新后需要重新确认）。
      </p>
    </div>
  );
}
