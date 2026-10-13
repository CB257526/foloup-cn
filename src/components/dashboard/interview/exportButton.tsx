"use client";

import { exportInterviewCsvAction } from "@/app/actions/export";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  interviewId: string;
  disabled?: boolean;
}

/**
 * 导出候选人评分 CSV。
 *
 * 关键行为：
 *   - 服务端返回结构化结果（`ok=false` 带中文原因），因此**失败时给出中文提示、绝不下载空文件**；
 *   - CSV 正文自带 UTF-8 BOM（在服务端拼好），中文表头在 Excel 里不会乱码；
 *   - 内容不含 API Key / 提示词 / 简历全文 / 专属 token（在 `lib/data/analytics.ts` 组装时就已排除）。
 */
function ExportButton({ interviewId, disabled }: Props) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await exportInterviewCsvAction(interviewId);

      if (!result.ok) {
        toast.error("导出失败", { description: result.message });

        return;
      }

      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      // 立刻回收，避免长时间持有 Blob。
      URL.revokeObjectURL(url);

      toast.success(`已导出 ${result.rowCount} 位候选人的评分`, {
        description: "文件为 UTF-8 编码的 CSV，可直接用 Excel 打开。",
      });
    } catch (error) {
      toast.error("导出失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="shrink-0"
      disabled={disabled || exporting}
      onClick={() => void handleExport()}
    >
      {exporting ? (
        <Loader2 size={16} className="mr-2 animate-spin" />
      ) : (
        <Download size={16} className="mr-2" />
      )}
      导出候选人评分 CSV
    </Button>
  );
}

export default ExportButton;
