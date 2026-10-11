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

export async function getAllEmailsAction(interviewId: string): Promise<unknown[]> {
  return responsesRepo.getAllEmailAddressesForInterview(interviewId);
}
