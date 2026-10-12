"use server";

import * as responsesRepo from "@/lib/data/responses";

/**
 * response 相关的 Server Actions。
 *
 * ⚠️ 接口已冻结（见 进度/P0-地基-数据层与构建.md 第 4 节）。
 * `details` / `analytics` 为 JSON 透传，数据层不解释其内部结构。
 */

type Json = Record<string, unknown>;

/** 返回新插入行的 id */
export async function createResponseAction(payload: Json): Promise<number | null> {
  return responsesRepo.createResponse(payload);
}

export async function saveResponseAction(payload: Json, callId: string): Promise<void> {
  return responsesRepo.saveResponse(payload, callId);
}

export async function updateResponseAction(payload: Json, callId: string): Promise<void> {
  return responsesRepo.updateResponse(payload, callId);
}

export async function getAllResponsesAction(interviewId: string): Promise<unknown[]> {
  return responsesRepo.getAllResponses(interviewId);
}

export async function getResponseByCallIdAction(callId: string): Promise<unknown> {
  return responsesRepo.getResponseByCallId(callId);
}

export async function deleteResponseAction(callId: string): Promise<void> {
  return responsesRepo.deleteResponse(callId);
}

/** 原子领取评分任务；并发请求中只有一个调用会返回 true。 */
export async function claimAnalysisAction(callId: string): Promise<boolean> {
  return responsesRepo.claimAnalysis(callId);
}

/** 保存评分结果，并把评分状态推进到 completed。 */
export async function completeAnalysisAction(callId: string, analytics: unknown): Promise<void> {
  return responsesRepo.completeAnalysis(callId, analytics);
}

/** 评分失败时释放领取状态，允许后续请求重试。 */
export async function releaseAnalysisAction(callId: string): Promise<void> {
  return responsesRepo.releaseAnalysis(callId);
}

export async function getAllEmailsAction(interviewId: string): Promise<unknown[]> {
  return responsesRepo.getAllEmailAddressesForInterview(interviewId);
}
