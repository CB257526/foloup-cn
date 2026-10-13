"use client";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import React, { useState, useCallback, useRef } from "react";

export type TableData = {
  call_id: string;
  name: string;
  overallScore: number;
  communicationScore: number;
  callSummary: string;
  /**
   * 能力维度分（后续 P1）。旧评分没有结构化维度时为空数组，
   * 表格显示「暂无能力分」而**不会**编造分数。
   */
  competencyScores?: Array<{ name: string; score: number | null }>;
};

interface DataTableProps {
  data: TableData[];
  interviewId: string;
}

function DataTable({ data, interviewId }: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "overallScore", desc: true }]);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = useCallback((rowId: string) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredRowId(rowId);
    }, 400);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setHoveredRowId(null);
  }, []);

  const customSortingFn = (a: any, b: any) => {
    if (a === null || a === undefined) {
      return -1;
    }
    if (b === null || b === undefined) {
      return 1;
    }

    return a - b;
  };

  const columns: ColumnDef<TableData>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            className={`w-full justify-start font-semibold text-[15px] mb-1 ${column.getIsSorted() ? "text-indigo-600" : "text-black"}`}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            候选人
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => (
        <div className="flex items-center justify-left min-h-[2.6em]">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-pointer mr-2 flex-shrink-0">
                  <ExternalLink
                    size={16}
                    className="text-current hover:text-indigo-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(
                        `/interviews/${interviewId}?call=${row.original.call_id}`,
                        "_blank",
                      );
                    }}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-gray-500 text-white font-normal">
                查看面试记录
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="truncate">{row.getValue("name")}</span>
        </div>
      ),
      sortingFn: (rowA, rowB, columnId) => {
        const a = rowA.getValue(columnId) as string;
        const b = rowB.getValue(columnId) as string;

        return a.toLowerCase().localeCompare(b.toLowerCase());
      },
    },
    {
      accessorKey: "overallScore",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            className={`w-full justify-start font-semibold text-[15px] mb-1 ${column.getIsSorted() ? "text-indigo-600" : "text-black"}`}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            综合评分
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => (
        <div className="min-h-[2.6em] flex items-center justify-center">
          {row.getValue("overallScore") ?? "-"}
        </div>
      ),
      sortingFn: (rowA, rowB, columnId) => {
        const a = rowA.getValue(columnId) as number | null;
        const b = rowB.getValue(columnId) as number | null;

        return customSortingFn(a, b);
      },
    },
    {
      accessorKey: "communicationScore",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            className={`w-full justify-start font-semibold text-[15px] mb-1 ${column.getIsSorted() ? "text-indigo-600" : "text-black"}`}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            沟通表达分
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => (
        <div className="min-h-[2.6em] flex items-center justify-center">
          {row.getValue("communicationScore") ?? "-"}
        </div>
      ),
      sortingFn: (rowA, rowB, columnId) => {
        const a = rowA.getValue(columnId) as number | null;
        const b = rowB.getValue(columnId) as number | null;

        return customSortingFn(a, b);
      },
    },
    {
      id: "competencyScores",
      header: () => (
        <div className="w-full justify-start font-semibold text-[15px] mb-1 text-black">
          能力维度
        </div>
      ),
      // 只放紧凑摘要（维度名 + 分数），长结论和原话证据放到展开行，避免一行塞满长段落。
      cell: ({ row }) => {
        const scores = row.original.competencyScores ?? [];

        if (scores.length === 0) {
          return (
            <div className="min-h-[2.6em] flex items-center text-xs text-slate-400">暂无能力分</div>
          );
        }

        return (
          <div className="flex flex-wrap gap-1 py-1">
            {scores.slice(0, 3).map((item) => (
              <span
                key={item.name}
                className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
              >
                {item.name} {item.score === null ? "—" : item.score}
              </span>
            ))}
            {scores.length > 3 && (
              <span className="self-center text-xs text-slate-500">+{scores.length - 3}</span>
            )}
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: "expand",
      header: () => (
        <div className="w-full text-center font-semibold text-[15px] mb-1 text-black">明细</div>
      ),
      cell: ({ row }) => {
        const expanded = expandedRowId === row.id;

        return (
          <div className="min-h-[2.6em] flex items-center justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={expanded ? "收起能力维度明细" : "展开能力维度明细"}
              onClick={() => setExpandedRowId(expanded ? null : row.id)}
            >
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </Button>
          </div>
        );
      },
      enableSorting: false,
    },
    {
      accessorKey: "callSummary",
      header: () => (
        <div className="w-full justify-start font-semibold text-[15px] mb-1 text-black">总结</div>
      ),
      cell: ({ row }) => {
        const summary = row.getValue("callSummary") as string;

        return (
          <div className="text-xs text-justify pr-4">
            <div
              className={`
                overflow-hidden transition-all duration-300 ease-in-out
                ${
                  hoveredRowId === row.id
                    ? "max-h-[1000px] opacity-100"
                    : "max-h-[2.6em] line-clamp-2 opacity-90"
                }
              `}
            >
              {summary}
            </div>
          </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="text-center">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <React.Fragment key={row.id}>
              <TableRow
                onMouseEnter={() => handleMouseEnter(row.id)}
                onMouseLeave={handleMouseLeave}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="text-justify align-top py-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
              {expandedRowId === row.id && (
                <TableRow>
                  <TableCell
                    colSpan={row.getVisibleCells().length}
                    className="bg-slate-50 align-top"
                  >
                    <div className="space-y-2 p-1">
                      <p className="text-xs font-medium text-slate-600">能力维度明细</p>
                      {(row.original.competencyScores ?? []).length === 0 ? (
                        <p className="text-xs text-slate-500">
                          本次评分没有结构化能力维度（可能是旧版评分）。可在该候选人的结果页点击「重新评分」补齐分项与候选人原话。
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                          {(row.original.competencyScores ?? []).map((item) => (
                            <div
                              key={item.name}
                              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                            >
                              <span className="truncate text-slate-600">{item.name}</span>
                              <span className="font-semibold text-indigo-700">
                                {item.score === null ? "未评估" : item.score}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-slate-500">
                        结论与候选人原话证据请在结果页「能力维度证据」中查看。
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default DataTable;
