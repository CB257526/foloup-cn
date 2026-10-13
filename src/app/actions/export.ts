"use server";

import { buildInterviewCsv, buildInterviewExportRows } from "@/lib/data/analytics";

/**
 * 岗位候选人评分 CSV 导出（后续 P1）。
 *
 * 设计取舍：
 *   - 返回**结构化结果**而不是直接抛出异常：Server Action 在线上会把异常信息抹成
 *     "An error occurred in the Server Components render"，HR 只会看到一句看不懂的英文；
 *     这里把中文原因带回去，界面能给出可操作提示，也不会下载一个空文件伪装成功。
 *   - 内容全部来自真实 response / candidate_invite，**不含** API Key、提示词、简历全文、专属 token。
 */
export type ExportCsvResult =
  | { ok: true; filename: string; csv: string; rowCount: number }
  | { ok: false; message: string };

/** 文件名里不允许出现路径分隔符等字符，统一替换掉。 */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || "未命名岗位";
}

export async function exportInterviewCsvAction(interviewId: string): Promise<ExportCsvResult> {
  try {
    if (typeof interviewId !== "string" || !interviewId.trim()) {
      return { ok: false, message: "缺少岗位编号，无法导出。" };
    }

    const { rows, dimensions, interviewName } = await buildInterviewExportRows(interviewId.trim());
    if (rows.length === 0) {
      return {
        ok: false,
        message: "该岗位还没有已完成的面试记录，暂时没有可以导出的候选人评分。",
      };
    }

    const csv = buildInterviewCsv(rows, dimensions);
    const date = new Date().toISOString().slice(0, 10);

    return {
      ok: true,
      filename: `${sanitizeFileName(interviewName)}-候选人评分-${date}.csv`,
      csv,
      rowCount: rows.length,
    };
  } catch (error) {
    console.error("[actions/export] exportInterviewCsvAction failed:", error);

    return {
      ok: false,
      message: error instanceof Error ? `导出失败：${error.message}` : "导出失败，请稍后重试。",
    };
  }
}
