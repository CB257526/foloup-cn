"use client";

import { Button } from "@/components/ui/button";
import { MAX_COMPETENCY_DIMENSIONS, createCompetencyDimensionKey } from "@/types/interview";
import type { CompetencyDimension } from "@/types/response";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

interface Props {
  dimensions: CompetencyDimension[];
  onChange: (next: CompetencyDimension[]) => void;
  disabled?: boolean;
}

/**
 * 岗位能力维度编辑器（创建岗位 / 编辑岗位共用）。
 *
 * 为什么共用一份组件：创建与编辑两处的维度语义必须完全一致（顺序 = 评分输出顺序、
 * 至少保留一项），分两份实现必然会漂移。评分时按 `name` 与模型输出对齐，
 * 因此这里只允许「改名/增删/排序」，不暴露内部 key。
 */
function CompetencyDimensionEditor({ dimensions, onChange, disabled }: Props) {
  const canDelete = dimensions.length > 1;

  const update = (index: number, patch: Partial<CompetencyDimension>) => {
    onChange(dimensions.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= dimensions.length) {
      return;
    }
    const next = dimensions.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  };

  const remove = (index: number) => {
    // 至少保留一个可评分维度：空数组会让 AI 评分无从解释，HR 也看不到分项依据。
    if (!canDelete) {
      return;
    }
    onChange(dimensions.filter((_, i) => i !== index));
  };

  const add = () => {
    if (dimensions.length >= MAX_COMPETENCY_DIMENSIONS) {
      return;
    }
    onChange([
      ...dimensions,
      { key: createCompetencyDimensionKey("新维度", dimensions.length), name: "", description: "" },
    ]);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">岗位能力维度</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            AI 评分会严格按这里的维度逐项打分，并用候选人的原话作为证据；未配置的维度不会出现。
            至少保留一项（最多 {MAX_COMPETENCY_DIMENSIONS} 项）。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || dimensions.length >= MAX_COMPETENCY_DIMENSIONS}
          onClick={add}
        >
          <Plus size={14} className="mr-1.5" />
          添加维度
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {dimensions.map((dimension, index) => (
          <div
            key={dimension.key}
            className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-2.5 sm:flex-row sm:items-center"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">
              {index + 1}
            </span>
            <input
              value={dimension.name}
              disabled={disabled}
              placeholder="维度名称，例如：问题解决"
              onChange={(event) => update(index, { name: event.target.value })}
              className="h-9 w-full min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            <input
              value={dimension.description ?? ""}
              disabled={disabled}
              placeholder="观察点（可选）"
              onChange={(event) => update(index, { description: event.target.value })}
              className="h-9 w-full min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 text-sm font-normal text-slate-600 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`上移 ${dimension.name || "维度"}`}
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
              >
                <ChevronUp size={15} />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`下移 ${dimension.name || "维度"}`}
                disabled={disabled || index === dimensions.length - 1}
                onClick={() => move(index, 1)}
              >
                <ChevronDown size={15} />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`删除 ${dimension.name || "维度"}`}
                disabled={disabled || !canDelete}
                onClick={() => remove(index)}
              >
                <Trash2 size={15} className={canDelete ? "text-rose-500" : "text-slate-300"} />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {!canDelete && (
        <p className="mt-2 text-xs text-amber-700">
          至少要保留一个能力维度，否则 AI 评分无法解释分数来源。
        </p>
      )}
    </div>
  );
}

export default CompetencyDimensionEditor;
