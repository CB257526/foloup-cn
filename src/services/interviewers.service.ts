import {
  createInterviewerAction,
  ensureDefaultInterviewersAction,
  getAllInterviewersAction,
  getInterviewerAction,
  getPublicInterviewerAction,
} from "@/app/actions/interviewers";
import type { Interviewer } from "@/types/interviewer";

/**
 * interviewer 数据门面。
 *
 * 原版用 `createClientComponentClient()` 在**浏览器**里直连 Supabase；
 * 现改为委托 Server Action（内部走 SQLite）。
 */

const getAllInterviewers = async (): Promise<Interviewer[]> => {
  try {
    return (await getAllInterviewersAction()) as Interviewer[];
  } catch (error) {
    console.error("[InterviewerService] getAllInterviewers failed:", error);

    return [];
  }
};

const createInterviewer = async (payload: any): Promise<Interviewer | null> => {
  try {
    return (await createInterviewerAction({ ...payload })) as Interviewer | null;
  } catch (error) {
    console.error("[InterviewerService] createInterviewer failed:", error);

    return null;
  }
};

/**
 * ⚠️ 声明为**非空**是为保持与原版一致的编译期契约（原版 supabase 返回 `any`，
 * `api/register-call`、`call/index.tsx` 均按非空使用）。
 * 底层 `lib/data/interviewers.getInterviewer()` 是诚实的 `Interviewer | null`。
 */
const getInterviewer = async (interviewerId: number | bigint): Promise<Interviewer> => {
  try {
    return (await getInterviewerAction(Number(interviewerId))) as Interviewer;
  } catch (error) {
    console.error("[InterviewerService] getInterviewer failed:", error);

    return null as unknown as Interviewer;
  }
};

const getPublicInterviewer = async (interviewerId: number | bigint): Promise<Pick<Interviewer, "id" | "name" | "image"> | null> => {
  try {
    return (await getPublicInterviewerAction(Number(interviewerId))) as Pick<Interviewer, "id" | "name" | "image"> | null;
  } catch (error) {
    console.error("[InterviewerService] getPublicInterviewer failed:", error);
    return null;
  }
};

/** 建两个默认面试官。替代原 `/api/create-interviewer`（Retell 版）。 */
const ensureDefaultInterviewers = async (): Promise<Interviewer[]> => {
  try {
    return (await ensureDefaultInterviewersAction()) as Interviewer[];
  } catch (error) {
    console.error("[InterviewerService] ensureDefaultInterviewers failed:", error);

    return [];
  }
};

export const InterviewerService = {
  getAllInterviewers,
  createInterviewer,
  getInterviewer,
  getPublicInterviewer,
  ensureDefaultInterviewers,
};
