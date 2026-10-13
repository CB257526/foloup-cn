"use server";

import { INTERVIEWERS } from "@/lib/constants";
import * as interviewersRepo from "@/lib/data/interviewers";
import { requireAdmin } from "@/lib/auth/admin";

/**
 * interviewer 相关的 Server Actions。
 *
 * ⚠️ 依赖说明：`ensureDefaultInterviewersAction` 的种子数据取自 `lib/constants.ts` 的
 * `INTERVIEWERS`（该文件属 P1，要改成中文人设）。P1 改完中文后，这里自动跟着变中文，
 * 不需要再动本文件。
 */

type Json = Record<string, unknown>;

export async function getAllInterviewersAction(): Promise<unknown[]> {
  await requireAdmin();
  return interviewersRepo.getAllInterviewers();
}

export async function getInterviewerAction(interviewerId: number | string): Promise<unknown> {
  await requireAdmin();
  return interviewersRepo.getInterviewer(Number(interviewerId));
}

/** 候选人面试只需要读取公开的面试官姓名和头像。 */
export async function getPublicInterviewerAction(interviewerId: number | string) {
  const interviewer = await interviewersRepo.getInterviewer(Number(interviewerId));
  if (!interviewer) return null;
  return { id: interviewer.id, name: interviewer.name, image: interviewer.image };
}

export async function createInterviewerAction(payload: Json): Promise<unknown> {
  await requireAdmin();
  return interviewersRepo.createInterviewer(payload);
}

/** 建两个默认面试官（原 `/api/create-interviewer` 的 SQLite 版，不再需要 Retell） */
export async function ensureDefaultInterviewersAction(): Promise<unknown[]> {
  await requireAdmin();
  const seeds = Object.values(INTERVIEWERS).map((item) => ({
    name: item.name,
    description: item.description,
    image: item.image,
    audio: item.audio,
    empathy: item.empathy,
    exploration: item.exploration,
    rapport: item.rapport,
    speed: item.speed,
  }));

  return interviewersRepo.ensureDefaultInterviewers(seeds);
}
