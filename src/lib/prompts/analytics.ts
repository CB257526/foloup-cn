/**
 * 面试评分分析提示词（中文版）。
 *
 * ⚠️ 与「面试中对话」那套提示词是两回事：
 *    - 本文件 = 面试**结束后**，把逐字稿喂给 LLM 做**评分与结构化分析**；
 *    - 面试中实时对话的人设提示词在 `src/lib/constants.ts`（归 P1 语音层），二者不要混用。
 *
 * ⚠️ 输出 JSON 的键名是**对外契约**，下游 UI 直接按这些键取值，不要改：
 *    `components/call/callInfo.tsx`、`components/dashboard/interview/summaryInfo.tsx`、
 *    `components/dashboard/interview/dataTable.tsx` 消费 overallScore / overallFeedback /
 *    communication.score / communication.feedback / questionSummaries[] / softSkillSummary。
 *
 * 🆕 后续 P1 新增 `competencyScores[]`（按岗位能力维度评分 + 原话证据）：
 *    - 维度名单由调用方传入（岗位 `competency_dimensions`），模型**不得新增维度**；
 *    - `evidence[].quote` 必须是候选人原话；服务端会逐条回查逐字稿，核对不上的直接丢弃；
 *    - 模型**不要**输出 `transcriptOffsetMs`：位置由服务端从真实结构化逐字稿里取，
 *      以免出现"看起来精确、实际是编的"时间戳。
 */

import type { CompetencyDimension } from "@/types/response";

export const SYSTEM_PROMPT =
  "你是面试逐字稿分析专家。你只能使用给定的主问题、给定的岗位能力维度进行分析，" +
  "不得自行生成或推断额外的问题或维度。引用候选人观点时必须逐字摘抄逐字稿原句，不得改写或编造。" +
  "所有输出必须使用简体中文。";

/** 把维度数组渲染成提示词里的清单文本。 */
function renderDimensionList(dimensions: CompetencyDimension[]): string {
  if (dimensions.length === 0) {
    return "（本次没有配置能力维度，请把 competencyScores 输出为空数组）";
  }

  return dimensions
    .map((dimension, index) => {
      const parts = [`${index + 1}. ${dimension.name}`];
      if (dimension.description) {
        parts.push(`说明：${dimension.description}`);
      }
      if (dimension.indicators?.length) {
        parts.push(`观察点：${dimension.indicators.join("、")}`);
      }

      return `   - ${parts.join("；")}`;
    })
    .join("\n");
}

export const getInterviewAnalyticsPrompt = (
  interviewTranscript: string,
  mainInterviewQuestions: string,
  competencyDimensions: CompetencyDimension[] = [],
) => `请分析下面这场面试的逐字稿，并给出结构化的评分与反馈：

###
逐字稿：
${interviewTranscript}

###
主问题清单：
${mainInterviewQuestions}

###
本次岗位能力维度（**只能评这些维度，不得新增、不得改名**）：
${renderDimensionList(competencyDimensions)}

请基于上述逐字稿与给出的主问题，按以下要求生成分析结果：

1. 总体评分（0-100）与总体评价（60 字以内）。评分需综合考虑以下因素：
   - 表达能力：用词是否准确、句子是否通顺、能否把复杂事情说清楚。
   - 回答速度：是否及时作答，还是明显拖延；回答是否简练，还是有冗长跑题的情况。
   - 自信程度：表达是否笃定、有底气，还是犹豫、含糊、缺少把握。
   - 条理性：回答结构是否清晰、层次是否分明，听者是否容易跟上。
   - 态度：面对面试与提问是否积极、尊重、投入。
   - 相关性：回答是否切题，有没有明显偏题、答非所问。
   - 专业深度：对岗位相关领域的理解是否深入，有无有见地的细节。
   - 问题解决能力：面对情景类/难题时的思路是否清晰，逻辑推理与分析是否到位。
   - 举例与佐证：是否用具体案例、数据或事实支撑自己的说法（体现经验与可信度）。
   - 倾听能力：是否在认真听题，能否针对追问给出贴合的回应。
   - 一致性：整场回答前后是否自洽，有无自相矛盾。
   - 应变能力：面对意外问题或追问时，能否灵活调整。

2. 表达能力评分（0-10）与评语（60 字以内）。请按下述 10 档标准打分（对应中文表达能力）：
   - 10 分：表达完全自如，用词准确、流畅，理解毫无障碍。
   - 09 分：表达自如，偶有小瑕疵或个别用词不当；面对陌生话题可能略有偏差，但能驾驭复杂论述。
   - 08 分：表达基本自如，偶有不准或误解；能清晰处理复杂信息与细致推理。
   - 07 分：表达有效，虽有瑕疵与误解，但能理解并使用较复杂的表达，尤其在熟悉的话题上。
   - 06 分：表达部分受限，能传达大意，但错误较多；可完成本职领域内的基本沟通。
   - 05 分：仅在熟悉场景下具备基本沟通能力，理解与表达都常有困难。
   - 04 分：在极为熟悉的场景下也只能听懂大意，沟通经常中断。
   - 03 分：理解对方表达有严重困难。
   - 02 分：除个别词句外基本无法用该语言沟通。
   - 01 分：完全没有回答问题。

3. 逐题小结：${mainInterviewQuestions}
   - 只使用给出的主问题，**必须把全部主问题带序号输出**，即使逐字稿中找不到。
   - 输出题目与小结时遵守以下规则：
      - 若某个主问题在逐字稿中**没有被问到**，输出该问题，小结写「未提问」。
      - 若某个主问题**被问到了但找不到候选人的回答**，输出该问题，小结写「未作答」。
      - 若某个主问题被问到、也能找到回答，则为该主问题提供小结，内容包含：
          a) 候选人对该主问题的回答要点
          b) 围绕该主问题产生的追问，以及候选人对追问的回答
      - 小结写成一段连贯的中文，把该主问题相关的信息都覆盖到。
      - question 字段必须原样引用该主问题的原文（可保留题目清单里的序号，不要改写、不要重述）。
4. 软素质总结：就自信度、领导力、适应力、批判性思维、决策能力等方面，给出一句 30 字以内的概括。
5. 能力维度评分（competencyScores）：**严格按上面「本次岗位能力维度」清单逐项评分**。
   - 每个维度给出 0-100 的分数、60 字以内的结论、风险提示，以及**支撑该结论的候选人原话**。
   - 名称必须与维度清单里的中文名称**完全一致**；清单外的维度一律不要输出。
   - evidence[].quote 必须是逐字稿中**候选人本人**说过的原句（逐字保留，不要改写、不要翻译、
     不要补字、不要省略号拼接）。如果该维度找不到候选人原话支撑，就给它空数组，
     不要用 AI 面试官的话或自己总结的句子充当证据。
   - 不要输出时间戳/偏移量字段（transcriptOffsetMs 由服务端根据逐字稿定位）。
   - riskFlags 用简短中文短语，如「缺少量化结果」「回答偏空泛」；没有风险就输出空数组。

请确保输出为合法的 JSON，结构如下：
{
  "overallScore": number,
  "overallFeedback": string,
  "communication": { "score": number, "feedback": string },
  "questionSummaries": [{ "question": string, "summary": string }],
  "softSkillSummary": string,
  "competencyScores": [
    {
      "name": string,
      "score": number,
      "feedback": string,
      "evidence": [{ "quote": string }],
      "riskFlags": [string]
    }
  ]
}

重要：只使用给定的主问题和给定的岗位能力维度。不要生成或推断额外的问题或维度。
evidence 里的引用必须逐字来自候选人发言。全程使用简体中文。`;
