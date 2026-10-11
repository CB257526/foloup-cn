"use server";

import { INTERVIEWERS } from "@/lib/constants";
import * as interviewersRepo from "@/lib/data/interviewers";

/**
 * interviewer 相关的 Server Actions。
 *
 * ⚠️ 依赖说明：`ensureDefaultInterviewersAction` 的种子数据取自 `lib/constants.ts` 的
 * `INTERVIEWERS`（该文件属 P1，要改成中文人设）。P1 改完中文后，这里自动跟着变中文，
 * 不需要再动本文件。
 */

type Json = Record<string, unknown>;

export async function getAllInterviewersAction(): Promise<unknown[]> {
  return interviewersRepo.getAllInterviewers();
}

export async function getInterviewerAction(interviewerId: number | string): Promise<unknown> {
  return interviewersRepo.getInterviewer(Number(interviewerId));
}

export async function createInterviewerAction(payload: Json): Promise<unknown> {
  return interviewersRepo.createInterviewer(payload);
}

/** 建两个默认面试官（原 `/api/create-interviewer` 的 SQLite 版，不再需要 Retell） */
export async function ensureDefaultInterviewersAction(): Promise<unknown[]> {
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
