import { submitFeedbackAction } from "@/app/actions/feedback";
import type { FeedbackData } from "@/types/response";

/**
 * feedback 数据门面。
 *
 * 原版用 `createClientComponentClient()` 在**浏览器**里直连 Supabase；
 * 现改为委托 Server Action（内部走 SQLite）。签名与行为不变。
 */

const submitFeedback = async (feedbackData: FeedbackData): Promise<unknown> => {
  try {
    return await submitFeedbackAction({ ...feedbackData });
  } catch (error) {
    console.error("[FeedbackService] submitFeedback failed:", error);
    throw error;
  }
};

export const FeedbackService = {
  submitFeedback,
};
