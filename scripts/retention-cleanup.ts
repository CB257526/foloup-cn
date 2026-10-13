import fs from "node:fs";
import path from "node:path";
import { formatRetentionLog, monthsAgo, resolveRetentionConfig } from "@/lib/data/retention";
import { runRetentionCleanup } from "@/lib/data/retention";
import { getDb } from "@/lib/db";

/**
 * 个人信息留存到期清理 —— 手工/定时执行的命令行入口。
 *
 * 运行方式（在 FoloUp 目录下）：
 *   # 只报告（默认，不会删任何数据）
 *   node --experimental-strip-types --import ./scripts/ts-path-alias.mjs scripts/retention-cleanup.ts
 *
 *   # 真实删除：必须显式 --apply，且服务端开关都打开
 *   RETENTION_DELETE_ENABLED=1 RETENTION_DRY_RUN=0 \
 *   node --experimental-strip-types --import ./scripts/ts-path-alias.mjs scripts/retention-cleanup.ts --apply
 *
 *   # 指定数据库（离线核对某个备份文件时用）
 *   SQLITE_DB_PATH=/path/to/foloup.db node ... scripts/retention-cleanup.ts
 *
 * 真实删除需要**三重条件同时满足**，任何一项不满足都只报告：
 *   ① 命令行显式带 --apply；
 *   ② 环境开关 RETENTION_DELETE_ENABLED=1（缺失/非法一律视为关闭）；
 *   ③ 环境开关 RETENTION_DRY_RUN=0（默认就是 1，即 dry-run）。
 *
 * 输出里只有数量与不可逆哈希，不含姓名、邮箱、简历、逐字稿、令牌、密钥与 prompt。
 */

type Options = {
  apply: boolean;
  asJson: boolean;
  help: boolean;
  dbPath?: string;
};

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, asJson: false, help: false };

  for (const arg of argv) {
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--json") {
      options.asJson = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--db=")) {
      options.dbPath = arg.slice("--db=".length);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(
    [
      "个人信息留存清理（默认 dry-run，不会删除任何数据）",
      "",
      "用法：node --experimental-strip-types --import ./scripts/ts-path-alias.mjs scripts/retention-cleanup.ts [选项]",
      "",
      "选项：",
      "  --apply        请求真实删除（仍需 RETENTION_DELETE_ENABLED=1 且 RETENTION_DRY_RUN=0）",
      "  --json         以 JSON 输出完整报告",
      "  --db=<路径>    指定 SQLite 文件（等价于设置 SQLITE_DB_PATH）",
      "  -h, --help     显示本帮助",
      "",
      "相关环境变量：",
      "  RETENTION_DELETE_ENABLED=1   打开删除总开关（默认关闭）",
      "  RETENTION_DRY_RUN=0          关闭 dry-run（默认 1，即只报告）",
      "  RETENTION_MONTHS=6           留存自然月（默认取 NEXT_PUBLIC_DATA_RETENTION_MONTHS，再默认 6）",
      "  SQLITE_DB_PATH               数据库位置（默认 ./data/foloup.db）",
    ].join("\n"),
  );
}

function printSummary(options: Options, dbPath: string): void {
  const config = resolveRetentionConfig();
  const report = runRetentionCleanup(getDb(), { apply: options.apply });

  if (options.asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const cutoff = monthsAgo(new Date(report.generatedAt), config.months);
  const lines: string[] = [];

  lines.push(`数据库：${dbPath}`);
  lines.push(`模式：${report.mode === "delete" ? "真实删除" : "仅报告（dry-run）"}`);
  lines.push(
    `留存期：${config.months} 个自然月（早于 ${cutoff.toISOString().slice(0, 10)} 结束的面试视为到期）`,
  );
  lines.push(
    `开关：RETENTION_DELETE_ENABLED=${config.enabled ? "已开启" : "未开启"} / RETENTION_DRY_RUN=${config.dryRun ? "开" : "关"} / 显式 --apply=${options.apply ? "是" : "否"}`,
  );
  if (config.notes.length > 0) {
    lines.push(`注意：${config.notes.join("；")}`);
  }
  lines.push("");
  lines.push(`扫描候选人邀请：${report.scan.scannedCandidates}`);
  lines.push(`判定到期（符合删除条件）：${report.scan.eligible.length}`);
  for (const [reason, count] of Object.entries(report.scan.skipped)) {
    lines.push(`  · 跳过（${reason}）：${count}`);
  }
  lines.push(
    `  · 跳过（历史 legacy response，无候选人关联）：${report.scan.legacyResponsesSkipped}`,
  );
  lines.push(`  · 跳过（孤儿 response，邀请已不存在）：${report.scan.orphanResponsesSkipped}`);
  lines.push(
    `  · 仅计数不删（同岗位反馈记录，保留政策待确认）：${report.scan.feedbackRowsPending}`,
  );
  lines.push("");
  lines.push(
    `已删除候选人：${report.purgedCandidates}（response ${report.purged.response} / consent_record ${report.purged.consent_record} / candidate_invite ${report.purged.candidate_invite}）`,
  );
  if (report.failures.length > 0) {
    lines.push(`失败：${JSON.stringify(report.failures)}`);
  }
  if (report.mode === "dry-run" && report.scan.eligible.length > 0) {
    lines.push("");
    lines.push("提示：以上只是报告。如确认要执行删除，请用 --apply 且打开两个环境开关。");
  }

  console.log(lines.join("\n"));
  console.log(formatRetentionLog(report));
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const dbPath =
    options.dbPath || process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "foloup.db");

  // 先落到环境变量上，保证 getDb() 打开的是同一个文件
  process.env.SQLITE_DB_PATH = dbPath;

  if (!fs.existsSync(dbPath)) {
    // 刻意不自动建库：路径写错时创建空库会让人误以为"清理完成、没有数据"
    console.error(`[retention] 找不到数据库文件：${dbPath}`);
    console.error("[retention] 请确认路径，或用 --db=<路径> / SQLITE_DB_PATH 指定。");
    process.exitCode = 1;
    return;
  }

  printSummary(options, dbPath);
}

main();
