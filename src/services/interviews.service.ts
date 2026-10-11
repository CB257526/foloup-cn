import {
  createInterviewAction,
  deleteInterviewAction,
  getAllInterviewsAction,
  getAllRespondentsAction,
  getInterviewByIdAction,
  updateInterviewAction,
} from "@/app/actions/interviews";
import type { Interview } from "@/types/interview";

/**
 * interview 数据门面。
 *
 * 原版用 `createClientComponentClient()` 在**浏览器**里直连 Supabase；
 * 现改为委托 Server Action（内部走 SQLite）。
 * 对外方法名与参数顺序保持不变，客户端组件无需改动调用方式。
 */

const getAllInterviews = async (): Promise<Interview[]> => {
  try {
    return (await getAllInterviewsAction()) as Interview[];
  } catch (error) {
    console.error("[InterviewService] getAllInterviews failed:", error);

    return [];
  }
};

/**
 * ⚠️ 声明为**非空**是为保持与原版一致的编译期契约（原版 supabase 返回 `any`，
 * `api/generate-insights`、`(user)/call/[interviewId]` 均按非空使用）。
 * 底层 `lib/data/interviews.getInterviewById()` 是诚实的 `Interview | null`。
 */
const getInterviewById = async (id: string): Promise<Interview> => {
  try {
    return (await getInterviewByIdAction(id)) as Interview;
  } catch (error) {
    console.error("[InterviewService] getInterviewById failed:", error);

    return null as unknown as Interview;
  }
};

const createInterview = async (payload: any): Promise<Interview | null> => {
  try {
    return (await createInterviewAction({ ...payload })) as Interview | null;
  } catch (error) {
    console.error("[InterviewService] createInterview failed:", error);

    return null;
  }
};

const updateInterview = async (payload: any, id: string): Promise<Interview | null> => {
  try {
    return (await updateInterviewAction({ ...payload }, id)) as Interview | null;
  } catch (error) {
    console.error("[InterviewService] updateInterview failed:", error);

    return null;
  }
};

const deleteInterview = async (id: string): Promise<void> => {
  try {
    await deleteInterviewAction(id);
  } catch (error) {
    console.error("[InterviewService] deleteInterview failed:", error);
  }
};

const getAllRespondents = async (interviewId: string): Promise<unknown[]> => {
  try {
    return await getAllRespondentsAction(interviewId);
  } catch (error) {
    console.error("[InterviewService] getAllRespondents failed:", error);

    return [];
  }
};

export const InterviewService = {
  getAllInterviews,
  getInterviewById,
  updateInterview,
  deleteInterview,
  getAllRespondents,
  createInterview,
};
