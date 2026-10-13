"use server";

import { CURRENT_CONSENT_VERSION, recordConsentByInviteToken } from "@/lib/data/consents";
import { resolveRetentionMonths } from "@/lib/data/retention";
import type { ConsentPolicy, ConsentSubmitInput, ConsentSubmitResult } from "@/types/candidate";
import { headers } from "next/headers";

/**
 * 候选人同意相关的 Server Actions。
 *
 * 与旧的 `recordCandidateConsentAction` 的关键区别：
 *   · 入参只认**专属令牌**，候选人身份由服务端反查，浏览器无法指定 candidate_id / interview_id；
 *   · user-agent 由**服务端从请求头**读取后压缩成摘要，客户端传什么都不作数
 *     （因此即使有人在请求里塞 API Key 或超长文本，也不会落库）；
 *   · 文案版本必须与当前版本严格一致，否则抛错 —— 页面据此阻止进入面试并给出重试入口。
 */
export async function recordConsentAction(input: ConsentSubmitInput): Promise<ConsentSubmitResult> {
  // ⚠️ Server Action 的入参由网络请求构造，TS 类型不构成运行时约束：
  //    先挡住"根本不是对象"的调用（null / 字符串 / 数组展开后字段全缺，会被当成"没同意"或更糟）。
  //    字段级的类型与长度校验统一收敛在数据层，避免两处规则漂移。
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("同意请求格式不正确，无法记录同意");
  }

  const requestHeaders = await headers();

  // 注意顺序：先展开调用方入参，再用服务端读到的 UA 覆盖 —— 服务端值胜出
  return recordConsentByInviteToken({
    ...input,
    userAgent: requestHeaders.get("user-agent"),
  });
}

/**
 * 同意策略（版本号 + 留存月数）由服务端下发，避免客户端各写一份版本常量。
 * 候选人页在渲染同意门之前取一次；版本不一致时意味着文案改过版，需要重新确认。
 */
export async function getConsentPolicyAction(): Promise<ConsentPolicy> {
  return { version: CURRENT_CONSENT_VERSION, retentionMonths: resolveRetentionMonths() };
}
