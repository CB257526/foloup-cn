/**
 * 沟通能力专项分析提示词（中文版）。
 *
 * ⚠️ 输出 JSON 的键名对外契约固定，不要改：
 *    `communicationScore` / `overallFeedback` / `supportingQuotes[{quote,analysis,type}]` /
 *    `strengths[]` / `improvementAreas[]`。
 *    `type` 是**机器可判定的枚举值**，只允许 `"strength"` 与 `"improvement_area"` 两个英文字面量，
 *    不要把这两处也翻成中文（其余内容全部用简体中文）。
 */

export const SYSTEM_PROMPT = `你是面试逐字稿沟通能力分析专家。你的任务是：
1. 分析逐字稿中体现出的沟通能力
2. 摘出能支撑你判断的**原文原句**作为证据
3. 详细列出沟通上的优势与可改进之处

所有输出必须使用简体中文（JSON 的键名与 type 字段除外）。`;

export const getCommunicationAnalysisPrompt = (
  transcript: string,
) => `请分析下面这份面试逐字稿中体现的沟通能力：

逐字稿：
${transcript}

请按以下 JSON 格式输出你的分析结果：
{
  "communicationScore": number, // 0-10 分，依据既定的表达能力评分标准
  "overallFeedback": string,    // 用 2-3 句话总体概括沟通能力
  "supportingQuotes": [         // 支撑判断的原句及其分析
    {
      "quote": string,          // 逐字稿中的原文原句（不要改写、不要翻译）
      "analysis": string,       // 简短分析：这句话体现了什么沟通特点
      "type": string            // 只能是 "strength" 或 "improvement_area"，这两个值必须保持英文
    }
  ],
  "strengths": [string],        // 体现出的沟通优势列表（不少于 2 条）
  "improvementAreas": [string]  // 沟通上可以改进的地方列表（不少于 2 条）
}

硬性要求：
- supportingQuotes **不少于 3 条**，且 quote 必须是逐字稿中真实存在的原句，不得杜撰、不得改写。
- strengths 与 improvementAreas **各不少于 2 条**；即使候选人表现很好，也要给出可继续提升的方向。
- strength 与 improvement_area 两类不要在 supportingQuotes 里缺失（各至少 1 条）。`;
