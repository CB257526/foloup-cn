import { finishCallSessionAction, startCallSessionAction } from "@/app/actions/call-sessions";
import {
  createConsentRecordAction,
  getCompetencyDimensionsAction,
  saveCompetencyDimensionsAction,
  withdrawConsentRecordAction,
} from "@/app/actions/call-sessions";
import {
  claimAnalysisAction,
  completeAnalysisAction,
  createResponseAction,
  deleteResponseAction,
  getAllEmailsAction,
  getAllResponsesAction,
  getResponseByCallIdAction,
  releaseAnalysisAction,
  saveResponseAction,
  updateResponseAction,
} from "@/app/actions/responses";
import type {
  CreateConsentRecordInput,
  FinishCallSessionInput,
  StartCallSessionInput,
} from "@/lib/data/call-sessions";
import type {
  CallSessionFinishResult,
  CallSessionStartResult,
  CompetencyDimensions,
  Response,
} from "@/types/response";

/**
 * response 数据门面 —— **接口已冻结**，见 进度/P0-地基-数据层与构建.md 第 4 节。
 *
 * 原版用 `createClientComponentClient()` 在**浏览器**里直连 Supabase；
 * 现改为委托 Server Action（内部走 SQLite）。
 *
 * P1 使用要点：
 *   实时语音连接成功后调用 startCallSession；结束时调用 finishCallSession。
 *   saveResponse 仅供候选人状态和已读标记更新，不能写结束时间、最终时长或会话详情。
 *   createConsentRecord / saveCompetencyDimensions 提供后续数据层接口，不代表相关页面业务已完成。
 *
 * `details` / `analytics` 是 JSON 透传 —— 存什么对象就读回什么对象，
 * 数据层不解释内部结构，types/response.ts 可以随意改。
 */

const createResponse = async (payload: any): Promise<number | null> => {
  try {
    return await createResponseAction({ ...payload });
  } catch (error) {
    console.error("[ResponseService] createResponse failed:", error);

    return null;
  }
};

const saveResponse = async (payload: any, call_id: string): Promise<void> => {
  try {
    await saveResponseAction({ ...payload }, call_id);
  } catch (error) {
    console.error("[ResponseService] saveResponse failed:", error);
  }
};

const updateResponse = async (payload: any, call_id: string): Promise<void> => {
  try {
    await updateResponseAction({ ...payload }, call_id);
  } catch (error) {
    console.error("[ResponseService] updateResponse failed:", error);
  }
};

const getAllResponses = async (interviewId: string): Promise<Response[]> => {
  try {
    return (await getAllResponsesAction(interviewId)) as Response[];
  } catch (error) {
    console.error("[ResponseService] getAllResponses failed:", error);

    return [];
  }
};

/**
 * ⚠️ 声明为**非空**是为保持与原版一致的编译期契约：
 * 原版 supabase 返回 `any`，`api/get-call`、`analytics.service`、`call/callInfo` 均按非空使用。
 * 底层 `lib/data/responses.getResponseByCallId()` 是诚实的 `ResponseRow | null`。
 * P1/P2 重写这些调用点后请改为可空 + 判空，届时把这里收紧。
 */
const getResponseByCallId = async (id: string): Promise<Response> => {
  try {
    return (await getResponseByCallIdAction(id)) as Response;
  } catch (error) {
    console.error("[ResponseService] getResponseByCallId failed:", error);

    return null as unknown as Response;
  }
};

const deleteResponse = async (id: string): Promise<void> => {
  try {
    await deleteResponseAction(id);
  } catch (error) {
    console.error("[ResponseService] deleteResponse failed:", error);
  }
};

/** 实时语音连接成功后才调用，开始时间由服务端生成。 */
const startCallSession = async (input: StartCallSessionInput): Promise<CallSessionStartResult> => {
  return startCallSessionAction(input);
};

/** 服务端幂等完成面试，并返回数据库计算出的最终时长和结束原因。 */
const finishCallSession = async (
  input: FinishCallSessionInput,
): Promise<CallSessionFinishResult> => {
  return finishCallSessionAction(input);
};

/** 原子领取评分任务，避免同一个 call_id 被重复触发模型。 */
const claimAnalysis = async (callId: string): Promise<boolean> => {
  return claimAnalysisAction(callId);
};

const completeAnalysis = async (callId: string, analytics: unknown): Promise<void> => {
  return completeAnalysisAction(callId, analytics);
};

const releaseAnalysis = async (callId: string): Promise<void> => {
  return releaseAnalysisAction(callId);
};

/** 保存分项同意与审计元数据，供后续同意流程调用。 */
const createConsentRecord = async (input: CreateConsentRecordInput) => {
  return createConsentRecordAction(input);
};

/** 记录撤回时间，原始同意记录继续保留。 */
const withdrawConsentRecord = async (id: number): Promise<boolean> => {
  return withdrawConsentRecordAction(id);
};

/** 保存岗位能力维度，供 P1 评分证据链复用。 */
const saveCompetencyDimensions = async (
  interviewId: string,
  dimensions: CompetencyDimensions,
): Promise<boolean> => {
  return saveCompetencyDimensionsAction(interviewId, dimensions);
};

/** 读取岗位能力维度；历史岗位返回空数组。 */
const getCompetencyDimensions = async (interviewId: string): Promise<CompetencyDimensions> => {
  return getCompetencyDimensionsAction(interviewId);
};

const getAllEmailAddressesForInterview = async (
  interviewId: string,
): Promise<Array<{ email: string }>> => {
  try {
    return (await getAllEmailsAction(interviewId)) as Array<{ email: string }>;
  } catch (error) {
    console.error("[ResponseService] getAllEmails failed:", error);

    return [];
  }
};

export const ResponseService = {
  createResponse,
  saveResponse,
  updateResponse,
  getAllResponses,
  getResponseByCallId,
  deleteResponse,
  startCallSession,
  finishCallSession,
  claimAnalysis,
  completeAnalysis,
  releaseAnalysis,
  createConsentRecord,
  withdrawConsentRecord,
  saveCompetencyDimensions,
  getCompetencyDimensions,
  getAllEmails: getAllEmailAddressesForInterview,
};
