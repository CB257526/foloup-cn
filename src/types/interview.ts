import type { CompetencyDimension } from "@/types/response";

export interface Question {
  id: string;
  question: string;
  follow_up_count: number;
}

export interface Quote {
  quote: string;
  call_id: string;
}

/** 建岗位表单用的字段集（单租户：已删 user_id / organization_id） */
export interface InterviewBase {
  name: string;
  /** 原版是 bigint（Postgres int8）。SQLite 无 int8，改为 number；0 表示"未选面试官" */
  interviewer_id: number;
  objective: string;
  question_count: number;
  time_duration: string;
  is_anonymous: boolean;
  questions: Question[];
  description: string;
  response_count: number;
}

export interface InterviewDetails {
  id: string;
  created_at: string;
  url: string | null;
  insights: string[];
  quotes: Quote[];
  details: any;
  is_active: boolean;
  theme_color: string;
  logo_url: string;
  respondents: string[];
  readable_slug: string;
  /**
   * 岗位能力维度（`interview.competency_dimensions` 的 JSON 数组）。
   *
   * 历史岗位可能为 `null` / `[]` —— 此时创建页与编辑页会显示下面的默认维度，
   * 但**不会**自动写库，必须由 HR 主动保存。
   */
  competency_dimensions?: CompetencyDimension[] | null;
}

export interface Interview extends InterviewBase, InterviewDetails {}

/* ------------------------------------------------------------------ */
/* 岗位能力维度：默认值与归一化                                          */
/* ------------------------------------------------------------------ */

/**
 * 初筛用的默认能力维度。
 *
 * 用途有三处，必须共用同一份定义，避免三处各写一套：
 *   1. 创建岗位表单的初始值；
 *   2. 编辑历史岗位（`competency_dimensions` 为空）时显示的「可编辑默认值」；
 *   3. 岗位完全没配维度时的评分兜底（否则评分结果无法解释）。
 */
export const DEFAULT_COMPETENCY_DIMENSIONS: CompetencyDimension[] = [
  {
    key: "professional_skills",
    name: "专业能力",
    description: "岗位相关专业知识与技能的掌握程度",
    indicators: ["技术深度", "行业经验", "工具与方法"],
  },
  {
    key: "problem_solving",
    name: "问题解决",
    description: "面对情景题时的分析思路与落地能力",
    indicators: ["结构化分析", "方案可行性", "结果导向"],
  },
  {
    key: "communication",
    name: "沟通协作",
    description: "表达是否清晰、是否具备团队协作意识",
    indicators: ["表达条理", "倾听与回应", "协作意识"],
  },
  {
    key: "learning_ability",
    name: "学习能力",
    description: "知识更新速度与面对新领域的方法",
    indicators: ["学习方法", "迁移能力", "自我驱动"],
  },
  {
    key: "motivation",
    name: "岗位动机",
    description: "求职动机与岗位匹配度",
    indicators: ["岗位理解", "稳定性", "职业规划"],
  },
];

/** 上限只是防止 HR 误操作塞入过多维度导致评分结果不可读。 */
export const MAX_COMPETENCY_DIMENSIONS = 8;

/** 为新增维度生成一个不与现有维度冲突的内部 key（只用于 React key / 去重，不参与评分）。 */
export function createCompetencyDimensionKey(name: string, index: number): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `dim_${slug || "item"}_${index}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 归一化能力维度数组。
 *
 * 规则：
 *   - 丢弃没有名称的项；名称按**首个出现的**去重（评分是按名称对齐的）；
 *   - 补全缺失的 `key`，避免 React 列表出现重复 key；
 *   - 最多保留 {@link MAX_COMPETENCY_DIMENSIONS} 项；
 *   - 无法得到任何有效维度时返回 `[]` —— 是否回退默认值由调用方决定。
 */
export function normalizeCompetencyDimensions(input: unknown): CompetencyDimension[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const result: CompetencyDimension[] = [];

  // ⚠️ 不用 `input.entries()` / for-of：本项目 tsconfig 是 target=es5 且未开 downlevelIteration，
  //    直接遍历迭代器会编译报错。这里用最朴素的下标循环。
  for (let index = 0; index < input.length; index += 1) {
    if (result.length >= MAX_COMPETENCY_DIMENSIONS) {
      break;
    }
    const item = input[index];
    if (!item || typeof item !== "object") {
      continue;
    }
    const source = item as Record<string, unknown>;
    const name = typeof source.name === "string" ? source.name.trim() : "";
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);

    const indicators = Array.isArray(source.indicators)
      ? source.indicators
          .map((indicator) => (typeof indicator === "string" ? indicator.trim() : ""))
          .filter(Boolean)
          .slice(0, 6)
      : undefined;
    const weight = Number(source.weight);

    result.push({
      key:
        typeof source.key === "string" && source.key.trim()
          ? source.key.trim()
          : createCompetencyDimensionKey(name, index),
      name,
      ...(typeof source.description === "string" && source.description.trim()
        ? { description: source.description.trim() }
        : {}),
      ...(indicators?.length ? { indicators } : {}),
      ...(Number.isFinite(weight) ? { weight } : {}),
    });
  }

  return result;
}

/**
 * 取实际生效的维度：岗位已配置就用自己的，没配置才回退默认值。
 *
 * ⚠️ 评分提示词只允许输出这里返回的维度，模型不得凭空扩展。
 */
export function resolveCompetencyDimensions(input: unknown): CompetencyDimension[] {
  const normalized = normalizeCompetencyDimensions(input);

  return normalized.length > 0 ? normalized : DEFAULT_COMPETENCY_DIMENSIONS;
}
