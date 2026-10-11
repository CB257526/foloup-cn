"use server";

import { chatCompletion, extractJson } from "@/lib/llm";
import { SYSTEM_PROMPT, getInterviewAnalyticsPrompt } from "@/lib/prompts/analytics";
import { InterviewService } from "@/services/interviews.service";
import { ResponseService } from "@/services/responses.service";
import type { Question } from "@/types/interview";
import type { Analytics } from "@/types/response";

/**
 * 面试评分分析（原版调 OpenAI gpt-4o，现走平台 LLM）。
 *
 * 评分逐字稿通常比出题长得多，且 deepseek-v4 / glm-5 的 `reasoning_content`（思考过程）
 * 与正文**共享** max_tokens 预算，所以这里显式给到 8000（默认 4000 恐被思考吃光 → JSON 截断）。
 */
const ANALYTICS_MAX_TOKENS = 8000;

export const generateInterviewAnalytics = async (payload: {
  callId: string;
  interviewId: string;
  transcript: string;
}) => {
  const { callId, interviewId, transcript } = payload;

  try {
    const response = await ResponseService.getResponseByCallId(callId);
    const interview = await InterviewService.getInterviewById(interviewId);

    if (response.analytics) {
      return { analytics: response.analytics as Analytics, status: 200 };
    }

    const interviewTranscript = transcript || response.details?.transcript;
    const questions = interview?.questions || [];
    const mainInterviewQuestions = questions
      .map((q: Question, index: number) => `${index + 1}. ${q.question}`)
      .join("\n");

    const prompt = getInterviewAnalyticsPrompt(interviewTranscript, mainInterviewQuestions);

    const content = await chatCompletion({
      system: SYSTEM_PROMPT,
      user: prompt,
      json: true, // 提示词要求输出 JSON，这里显式声明（平台约束见 lib/llm.ts）
      maxTokens: ANALYTICS_MAX_TOKENS,
    });

    const analyticsResponse = extractJson<Analytics & { mainInterviewQuestions?: string[] }>(content);

    analyticsResponse.mainInterviewQuestions = questions.map((q: Question) => q.question);

    return { analytics: analyticsResponse, status: 200 };
  } catch (error) {
    console.error("Error in LLM request:", error);

    return { error: "internal server error", status: 500 };
  }
};
