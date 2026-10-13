import { timingSafeEqual } from "node:crypto";
import {
  classifyRetentionError,
  formatRetentionLog,
  runRetentionCleanup,
} from "@/lib/data/retention";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";

/**
 * 内部留存清理入口（受服务端密钥保护）。
 *
 * 为什么要有这个路由：D-9 —— 页面向候选人承诺「到期自动删除」，但此前**没有任何执行者**。
 * 这个路由让部署层可以每天用一条命令触发真实清理，而不必在应用里塞定时器
 * （自托管场景下应用内的定时器重启即丢，不可靠）。
 *
 * 安全边界（任一不满足都只报告、不删除）：
 *   1. 必须带 `x-retention-key`（或 `Authorization: Bearer`）且与 `RETENTION_API_KEY` 一致；
 *      服务端未配置该密钥时一律返回 503，绝不"无密钥也能删"。用定长比较，避免时序侧信道。
 *   2. 只接受 POST。GET 直接 405 —— 浏览器直接打开链接、爬虫、预取都不会触发任何动作。
 *   3. 真实删除还要同时满足：body `{ "apply": true }`、`RETENTION_DELETE_ENABLED=1`、
 *      `RETENTION_DRY_RUN=0`。默认（关开关 / dry-run / 不带 apply）只产出报告。
 *
 * 日志只有数量与不可逆哈希：不打印姓名、邮箱、简历、逐字稿、令牌、密钥与 prompt。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readKeyValue(raw: string | null): string {
  if (!raw) {
    return "";
  }
  const bearer = /^Bearer\s+(.+)$/i.exec(raw.trim());

  return (bearer ? bearer[1] : raw).trim();
}

function authorize(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = (process.env.RETENTION_API_KEY ?? "").trim();

  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "服务端未配置 RETENTION_API_KEY，已拒绝所有清理请求（不会删除任何数据）",
    };
  }

  const provided = readKeyValue(
    req.headers.get("x-retention-key") ?? req.headers.get("authorization"),
  );
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (
    provided.length === 0 ||
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return { ok: false, status: 401, error: "未授权" };
  }

  return { ok: true };
}

export async function GET() {
  return NextResponse.json(
    { error: "留存清理只接受 POST。GET 被拒绝，以避免浏览器直接打开链接或爬虫预取触发删除。" },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function POST(req: Request) {
  const auth = authorize(req);

  if (!auth.ok) {
    logger.warn(`retention-cleanup: 请求被拒绝（${auth.status}）`);

    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rawBody = await req.text();
  let apply = false;

  if (rawBody.trim()) {
    try {
      const parsed = JSON.parse(rawBody) as { apply?: unknown };

      apply = parsed?.apply === true || parsed?.apply === "true";
    } catch {
      return NextResponse.json(
        { error: '请求体必须是 JSON，例如 {"apply":true}' },
        { status: 400 },
      );
    }
  }

  try {
    const report = runRetentionCleanup(getDb(), { apply });

    // 只落一行结构化日志：数量 + 开关快照 + 失败哈希
    logger.info(formatRetentionLog(report));

    return NextResponse.json(report, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    // ⚠️ 只记**稳定分类**，不记异常原文：数据库异常的 message 可能夹带 SQL 语句与绑定参数
    //    （也就可能带邮箱、逐字稿片段），原样落日志会破坏「日志不含敏感内容」的承诺。
    logger.error(`retention-cleanup: 执行失败 code=${classifyRetentionError(error)}`);

    return NextResponse.json({ error: "清理执行失败，请查看服务端日志" }, { status: 500 });
  }
}
