import { chatCompletion, extractJson } from "@/lib/llm";
import { logger } from "@/lib/logger";
import {
  SYSTEM_PROMPT,
  getCommunicationAnalysisPrompt,
} from "@/lib/prompts/communication-analysis";
import { NextResponse } from "next/server";

/**
 * 沟通分析要输出多条「原句 + 分析」，比出题长得多。
 * 实测（deepseek-v4.1-flash，3 轮对话的逐字稿）：思考约 2900 tok + 正文约 1000 tok，
 * 默认的 4000 会**贴着上限**、偶发被截断成不完整 JSON → 解析失败 → 500。
 * 给到 8000 留足余量（max_tokens 只是上限，用不到不额外计费）。
 */
const COMMUNICATION_MAX_TOKENS = 8000;

export async function POST(req: Request) {
  logger.info("analyze-communication request received");

  try {
    const body = await req.json();
    const { transcript } = body;

    if (!transcript) {
      return NextResponse.json({ error: "Transcript is required" }, { status: 400 });
    }

    const content = await chatCompletion({
      system: SYSTEM_PROMPT,
      user: getCommunicationAnalysisPrompt(transcript),
      json: true, // 提示词要求输出 JSON，这里显式声明（平台约束见 lib/llm.ts）
      maxTokens: COMMUNICATION_MAX_TOKENS,
    });

    const analysis = extractJson<Record<string, unknown>>(content);

    logger.info("Communication analysis completed successfully");

    return NextResponse.json({ analysis }, { status: 200 });
  } catch (error) {
    // 带上具体原因，否则线上只能看到一句「Internal server error」，无法定位
    logger.error("Error analyzing communication skills", error instanceof Error ? error.message : String(error));

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
