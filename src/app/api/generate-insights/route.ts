import { chatCompletion, extractJson } from "@/lib/llm";
import { logger } from "@/lib/logger";
import { SYSTEM_PROMPT, createUserPrompt } from "@/lib/prompts/generate-insights";
import { InterviewService } from "@/services/interviews.service";
import { ResponseService } from "@/services/responses.service";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  logger.info("generate-insights request received");
  const body = await req.json();

  const responses = await ResponseService.getAllResponses(body.interviewId);
  const interview = await InterviewService.getInterviewById(body.interviewId);

  // 逐字稿摘要来源修正（缺陷 D-7）：
  // 原版从 Retell 的 `details.call_analysis.call_summary` 取，该字段随 Retell 一起被移除，
  // 继续读会得到 undefined 并被拼成字符串 "undefined" 喂给模型。
  // 现在改用评分产出的 `analytics.softSkillSummary`；取不到就跳过（不要拼进 undefined）。
  const summaryParts: string[] = [];
  for (const response of responses ?? []) {
    const summary = response.analytics?.softSkillSummary;
    if (typeof summary === "string" && summary.trim()) {
      summaryParts.push(summary.trim());
    }
  }
  const callSummaries = summaryParts.join("\n");

  try {
    const prompt = createUserPrompt(
      callSummaries,
      interview.name,
      interview.objective,
      interview.description,
    );

    const content = await chatCompletion({
      system: SYSTEM_PROMPT,
      user: prompt,
      json: true, // 提示词要求输出 JSON，这里显式声明（平台约束见 lib/llm.ts）
    });

    const insightsResponse = extractJson<{ insights?: unknown[] }>(content);

    await InterviewService.updateInterview(
      { insights: insightsResponse.insights },
      body.interviewId,
    );

    logger.info("Insights generated successfully");

    return NextResponse.json(
      {
        response: content,
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error("Error generating insights", error instanceof Error ? error.message : String(error));

    return NextResponse.json({ error: "internal server error" }, { status: 500 });
  }
}
