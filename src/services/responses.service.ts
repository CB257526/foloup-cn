import {
  createResponseAction,
  deleteResponseAction,
  getAllEmailsAction,
  getAllResponsesAction,
  getResponseByCallIdAction,
  saveResponseAction,
  updateResponseAction,
} from "@/app/actions/responses";
import type { Response } from "@/types/response";

/**
 * response 数据门面 —— **接口已冻结**，见 进度/P0-地基-数据层与构建.md 第 4 节。
 *
 * 原版用 `createClientComponentClient()` 在**浏览器**里直连 Supabase；
 * 现改为委托 Server Action（内部走 SQLite）。
 *
 * P1 使用要点：
 *   await ResponseService.createResponse({ interview_id, call_id, email, name });
 *   await ResponseService.saveResponse(
 *     { transcript, details, duration, is_ended: true, tab_switch_count }, callId);
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
  getAllEmails: getAllEmailAddressesForInterview,
};
