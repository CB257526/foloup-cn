/**
 * 面试洞察（Insights）生成提示词（中文版）。
 *
 * ⚠️ 输出 JSON 的键名对外契约固定：只能是 `insights`，值为 3 条洞察组成的数组。
 *    调用方 `src/app/api/generate-insights/route.ts` 会取 `insights` 写回 interview 表。
 */

export const SYSTEM_PROMPT =
  "你是从面试问答记录中挖掘深层洞察的专家。所有输出必须使用简体中文。";

export const createUserPrompt = (
  callSummaries: string,
  interviewName: string,
  interviewObjective: string,
  interviewDescription: string,
) => {
  return `假设你是一位擅长从通话摘要中挖掘深层洞察的面试官。请根据下面的通话摘要与岗位信息，生成洞察。

    ###
    通话摘要：
    ${callSummaries}

    ###
    岗位名称：${interviewName}
    招聘目标：${interviewObjective}
    岗位描述：${interviewDescription}

    请从上述通话摘要中提炼 3 条洞察，突出能反映候选人群体特征与面试体验的信号。只输出洞察本身，**不要出现候选人姓名或其他可识别到个人的信息**。
    每条洞察不超过 30 字。

    请以 JSON 格式输出，键为 "insights"，值为包含 3 条洞察的数组。全部使用简体中文。`;
};
