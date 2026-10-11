"use server";

import * as feedbackRepo from "@/lib/data/feedback";

/** feedback 相关的 Server Actions */

type Json = Record<string, unknown>;

export async function submitFeedbackAction(payload: Json): Promise<unknown> {
  return feedbackRepo.submitFeedback(payload);
}
