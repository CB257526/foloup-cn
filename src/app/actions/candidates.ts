"use server";

import * as candidateRepo from "@/lib/data/candidates";
import type { CreateCandidateInviteInput } from "@/types/candidate";
import { nanoid } from "nanoid";

/** 创建随机度足够高的候选人专属链接，令牌不使用姓名、邮箱等可猜测信息。 */
export async function createCandidateInviteAction(input: CreateCandidateInviteInput) {
  const invite = await candidateRepo.createCandidateInvite(input, nanoid(21), nanoid(32));
  return {
    id: invite.id,
    interview_id: invite.interview_id,
    name: invite.name,
    email: invite.email,
    invite_token: invite.invite_token,
    status: invite.status,
    created_at: invite.created_at,
  };
}

/** HR 只需岗位候选人状态清单，简历全文不会被批量传到前端。 */
export async function getCandidateInvitesForInterviewAction(interviewId: string) {
  return candidateRepo.getCandidateInvitesForInterview(interviewId);
}

/** HR 打开候选人资料时读取完整简历正文。 */
export async function getCandidateInviteByIdAction(id: string, interviewId: string) {
  return candidateRepo.getCandidateInviteById(id, interviewId);
}

/** 候选人打开个人链接后读取自己的面试信息和简历文件名。 */
export async function getPublicCandidateInviteByTokenAction(token: string) {
  return candidateRepo.getPublicCandidateInviteByToken(token);
}

/** 撤销未完成候选人的邀请链接，已完成的面试数据保持不变。 */
export async function revokeCandidateInviteAction(id: string, interviewId: string) {
  return candidateRepo.revokeCandidateInvite(id, interviewId);
}

/**
 * ⚠️ 同意留痕**不再**从这里暴露：旧实现接受浏览器提交的 `id` / `interviewId`，
 * 身份可被伪造。现已统一收敛到 `src/app/actions/consents.ts`（只认专属令牌）。
 */

/** 候选人确认删除后，同步清除简历、专属链接、面试结果和同意留痕。 */
export async function deleteCandidatePersonalDataAction(id: string, interviewId: string) {
  return candidateRepo.deleteCandidatePersonalData(id, interviewId);
}
