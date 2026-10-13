"use server";

import { normalizeAnalyticsResult } from "@/lib/data/analytics";
import { chatCompletion, extractJson } from "@/lib/llm";
import { SYSTEM_PROMPT, getInterviewAnalyticsPrompt } from "@/lib/prompts/analytics";
import { InterviewService } from "@/services/interviews.service";
import { ResponseService } from "@/services/responses.service";
import { resolveCompetencyDimensions } from "@/types/interview";
import type { AnalysisFailureCode, Analytics, TranscriptTurn } from "@/types/response";

/**
 * 面试评分分析（原版调 OpenAI gpt-4o，现走平台 LLM）。
 *
 * 评分逐字稿通常比出题长得多，且 deepseek-v4 / glm-5 的 `reasoning_content`（思考过程）
 * 与正文**共享** max_tokens 预算，所以这里显式给到 8000（默认 4000 恐被思考吃光 → JSON 截断）。
 */
const ANALYTICS_MAX_TOKENS = 8000;

export interface AnalyticsGenerationResult {
  status: number;
  analytics?: Analytics;
  /** 非致命问题（模型漏字段等），用于进度文档与排查 */
  warnings?: string[];
  /** 失败分类，交给路由写进 details.diagnostics.analysis_error 供 HR 看到可操作提示 */
  code?: AnalysisFailureCode;
  message?: string;
}

/**
 * 把 `chatCompletion` / JSON 解析抛出的异常翻译成 HR 能照着做的分类。
 *
 * 平台实测的失败形态：`deepseek-v4` 系列思考过程吃光 max_tokens 会出现「HTTP 200 但正文为空」，
 * 这**不是**接口不通，必须与"没配密钥""模型返回垃圾"区分开，否则 HR 只会看到一句"暂无评分"。
 */
function classifyError(error: unknown): { code: AnalysisFailureCode; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/API 密钥|apiKey|api key/i.test(message)) {
    return { code: "no_api_key", message: "尚未配置大模型 API 密钥，无法评分。" };
  }
  if (/正文为空/.test(message)) {
    return {
      code: "empty_output",
      message: "模型返回 200 但正文为空（max_tokens 被思考过程吃光）。",
    };
  }
  if (/截断/.test(message)) {
    return { code: "truncated", message: "模型的 JSON 输出被 max_tokens 截断。" };
  }
  if (/超时/.test(message)) {
    return { code: "timeout", message: "评分请求超时。" };
  }
  if (/无法从模型输出中解析出 JSON|待解析的 JSON 内容为空/.test(message)) {
    return { code: "invalid_json", message: "模型没有返回可解析的 JSON。" };
  }

  return { code: "unknown", message: message.slice(0, 300) };
}

/**
 * 生成一次面试的结构化评分。
 *
 * 数据来源优先级（后续 P1 要求）：
 *   1. 有 `candidate_id` 的结果优先使用 **response.details.interview_questions**（该候选人确认过的专属题快照）；
 *   2. 专属题缺失时才回退到岗位模板题目。
 * 能力维度则始终取**当前岗位配置**（`interview.competency_dimensions`），没配置才用默认维度，
 * 保证"岗位配了维度 ⇒ 维度真的进入模型提示词"。
 */
export const generateInterviewAnalytics = async (payload: {
  callId: string;
  interviewId: string;
  transcript: string;
}): Promise<AnalyticsGenerationResult> => {
  const { callId, interviewId, transcript } = payload;

  try {
    const response = await ResponseService.getResponseByCallId(callId);
    if (!response?.call_id) {
      return { status: 404, code: "unknown", message: "未找到该面试记录，无法评分。" };
    }
    const interview = await InterviewService.getInterviewById(interviewId);

    // ⚠️ 只有"已完成"的记录才允许直接复用旧评分。
    //    重新评分时路由会先把 analysis_status 置为 processing，因此这里不会把旧结果当成缓存返回，
    //    避免"重新评分后又看到上一版分数"。
    if (response.analytics && response.analysis_status === "completed") {
      return { status: 200, analytics: response.analytics as Analytics };
    }

    const interviewTranscript = transcript || response.details?.transcript || "";

    const inviteQuestions = response.details?.interview_questions;
    const hasInviteQuestions = Array.isArray(inviteQuestions) && inviteQuestions.length > 0;
    const questions = hasInviteQuestions
      ? (inviteQuestions as unknown[]).map((question) => ({ question: String(question) }))
      : (interview?.questions ?? []);
    const mainInterviewQuestions = questions
      .map((q: { question: string }, index: number) => `${index + 1}. ${q.question}`)
      .join("\n");

    // 岗位能力维度：使用当前岗位配置，未配置时回退默认维度（否则评分结果无法解释）。
    const dimensions = resolveCompetencyDimensions(interview?.competency_dimensions);

    const transcriptObject = Array.isArray(response.details?.transcript_object)
      ? (response.details?.transcript_object as TranscriptTurn[])
      : null;

    const prompt = getInterviewAnalyticsPrompt(
      interviewTranscript,
      mainInterviewQuestions,
      dimensions,
    );

    const content = await chatCompletion({
      system: SYSTEM_PROMPT,
      user: prompt,
      json: true, // 提示词要求输出 JSON，这里显式声明（平台约束见 lib/llm.ts）
      maxTokens: ANALYTICS_MAX_TOKENS,
    });

    // JSON 解析失败要单独分类，否则会被下游误判成"接口不通"。
    let parsed: unknown;
    try {
      parsed = extractJson<unknown>(content);
    } catch (error) {
      const classified = classifyError(error);

      return { status: 500, code: classified.code, message: classified.message };
    }

    const validation = normalizeAnalyticsResult(parsed, { dimensions, transcriptObject });
    if (!validation.ok) {
      return { status: 500, code: validation.code, message: validation.message };
    }

    // 逐题小结/问题清单必须与本次候选人的专属题快照一致，这里把实际使用的问题列表一并落库。
    const analytics = {
      ...validation.analytics,
      mainInterviewQuestions: questions.map((q: { question: string }) => q.question),
    } as Analytics;

    return { status: 200, analytics, warnings: validation.warnings };
  } catch (error) {
    console.error("Error in LLM request:", error);
    const classified = classifyError(error);

    return { status: 500, code: classified.code, message: classified.message };
  }
};
