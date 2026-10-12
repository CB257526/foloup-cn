"use server";

import {
  type CreateConsentRecordInput,
  type FinishCallSessionInput,
  type StartCallSessionInput,
  createConsentRecord,
  finishCallSession,
  getCompetencyDimensions,
  saveCompetencyDimensions,
  startCallSession,
  withdrawConsentRecord,
} from "@/lib/data/call-sessions";
import type { CompetencyDimensions } from "@/types/response";

/** 实时语音连接成功后写入服务端开始证据。 */
export async function startCallSessionAction(input: StartCallSessionInput) {
  return startCallSession(input);
}

/** 由服务端生成结束时间和权威时长，并按 call_id 幂等完成。 */
export async function finishCallSessionAction(input: FinishCallSessionInput) {
  return finishCallSession(input);
}

/** 保存候选人分项同意记录，保留数据库生成的主键和创建时间。 */
export async function createConsentRecordAction(input: CreateConsentRecordInput) {
  return createConsentRecord(input);
}

/** 记录同意撤回时间，不删除已形成的审计记录。 */
export async function withdrawConsentRecordAction(id: number) {
  return withdrawConsentRecord(id);
}

/** 保存岗位能力维度 JSON 数组，供后续岗位配置页面调用。 */
export async function saveCompetencyDimensionsAction(
  interviewId: string,
  dimensions: CompetencyDimensions,
): Promise<boolean> {
  return saveCompetencyDimensions(interviewId, dimensions);
}

/** 读取岗位能力维度；历史岗位或空字段返回空数组。 */
export async function getCompetencyDimensionsAction(
  interviewId: string,
): Promise<CompetencyDimensions> {
  return getCompetencyDimensions(interviewId);
}
