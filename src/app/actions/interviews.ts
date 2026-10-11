"use server";

import * as interviewsRepo from "@/lib/data/interviews";
import { nanoid } from "nanoid";

/**
 * interview 相关的 Server Actions。
 * 客户端组件（建岗位弹窗、编辑岗位等）走这里；服务端页面直接 import `@/lib/data/interviews`。
 */

type Json = Record<string, unknown>;

/**
 * 保留中文/字母/数字，其余替换为连字符。
 * 注意：tsconfig `target` 是 es5，正则不能用 `u` 标志（TS1501），这里用显式码点区间。
 */
function slugify(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^一-龥a-z0-9-]/g, "")
    .slice(0, 60);
}

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
  const baseUrl = process.env.NEXT_PUBLIC_LIVE_URL || "";
  const urlId = nanoid();
  const url = `${baseUrl}/call/${urlId}`;
  const nameSlug = slugify(payload.name);

  // 单租户：不再拼 organization 前缀，slug = 岗位名 + 短随机后缀（避免重名冲突）
  const readableSlug = `${nameSlug}-${nanoid(6)}`;

  return interviewsRepo.createInterview({
    ...payload,
    id: payload.id ?? urlId,
    url,
    readable_slug: readableSlug,
  });
}

export async function updateInterviewAction(payload: Json, id: string): Promise<unknown> {
  return interviewsRepo.updateInterview(payload, id);
}

export async function deleteInterviewAction(id: string): Promise<void> {
  return interviewsRepo.deleteInterview(id);
}
