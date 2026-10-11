import { chatCompletion } from "@/lib/llm";
import { logger } from "@/lib/logger";
import { SYSTEM_PROMPT, generateQuestionsPrompt } from "@/lib/prompts/generate-questions";
import { NextResponse } from "next/server";

// 出题要点：平台 LLM 的默认超时是 50s，正好卡在本路由的 60s 上限之内。
// 实测出题耗时：deepseek-v4.1-flash ≈2.3s / qwen-max ≈3.4s / glm-5 ≈12.6s / deepseek-v4-pro ≈35s。
export const maxDuration = 60;

export async function POST(req: Request) {
  logger.info("generate-interview-questions request received");
  const body = await req.json();

  try {
    const content = await chatCompletion({
      system: SYSTEM_PROMPT,
      user: generateQuestionsPrompt(body),
      json: true, // 提示词要求输出 JSON，这里显式声明（平台约束见 lib/llm.ts）
    });

    logger.info("Interview questions generated successfully");

    return NextResponse.json(
      {
        response: content,
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error(
      "Error generating interview questions",
      error instanceof Error ? error.message : String(error),
    );

    return NextResponse.json({ error: "internal server error" }, { status: 500 });
  }
}
