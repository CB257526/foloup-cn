"use server";

import * as interviewsRepo from "@/lib/data/interviews";
import { nanoid } from "nanoid";

/**
 * interview 相关的 Server Actions。
 * 客户端组件（建岗位弹窗、编辑岗位等）走这里；服务端页面直接 import `@/lib/data/interviews`。
 */

type Json = Record<string, unknown>;

export async function getAllInterviewsAction(): Promise<unknown[]> {
  return interviewsRepo.getAllInterviews();
}

export async function getInterviewByIdAction(id: string): Promise<unknown> {
  return interviewsRepo.getInterviewById(id);
}

export async function getAllRespondentsAction(interviewId: string): Promise<unknown[]> {
  return interviewsRepo.getAllRespondents(interviewId);
}

export async function createInterviewAction(payload: Json): Promise<unknown> {
  // 岗位是可复用模板，不在模板保存时生成公共候选人链接。
  // 每位候选人的唯一令牌只在 HR 确认其简历专属问题后创建。
  const id = typeof payload.id === "string" && payload.id ? payload.id : nanoid(21);

  return interviewsRepo.createInterview({
    ...payload,
    id,
    url: null,
    readable_slug: null,
  });
}

export async function updateInterviewAction(payload: Json, id: string): Promise<unknown> {
  return interviewsRepo.updateInterview(payload, id);
}

export async function deleteInterviewAction(id: string): Promise<void> {
  return interviewsRepo.deleteInterview(id);
}
