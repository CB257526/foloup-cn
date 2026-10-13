import { REALTIME_MODEL, REALTIME_WS_BASE } from "@/lib/constants";
import { getRuntimeAppSettings } from "@/lib/data/settings";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";

/**
 * 候选人设备预检用的**只读**探测接口。
 *
 * 它回答两个真问题：
 *   1. 浏览器能不能连上本服务的接口（网络通不通）；
 *   2. 服务端到底有没有配好语音服务（QWEN_API_KEY / 实时模型），
 *      否则候选人一路点到最后才开始报错，体验很差。
 *
 * ⚠️ 它**不做**下面这些事（这是刻意的）：
 *   · 不建立任何实时语音 WebSocket 会话 —— 平台的实时会话是计费的、且没有"空探针"的官方约定，
 *     用它来"预检"会白白消耗配额，也可能把 api_key 分发给只是路过页面的访问者；
 *   · 不写数据库：不创建 response、不改 candidate_invite（不消费候选人的专属链接）；
 *   · 不读写任何候选人个人信息，不接收令牌，因此这个接口不带任何身份信息。
 *
 * 因此返回里的 `realtime.verified` 恒为 false，`note` 明确告诉候选人：
 * 真实的实时连接会在点「开始面试」时再做一次验证。**不允许用 HTTP 200 冒充 WebSocket 成功。**
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let configured = false;
  let model = REALTIME_MODEL;

  try {
    const settings = getRuntimeAppSettings();

    configured = Boolean(settings.apiKey);
    model = settings.realtimeModel || REALTIME_MODEL;
  } catch (error) {
    // 读设置失败不能把预检变成 500，否则候选人会以为是自己网络的问题
    logger.error("realtime-preflight: 读取运行时设置失败");
  }

  return NextResponse.json(
    {
      ok: true,
      serverTime: new Date().toISOString(),
      realtime: {
        /** 服务端是否已配置平台密钥 */
        configured,
        /** 实际会使用的实时语音模型（不含密钥） */
        model,
        /** WebSocket 主机（不含密钥与查询参数） */
        host: (() => {
          try {
            return new URL(REALTIME_WS_BASE).host;
          } catch {
            return "";
          }
        })(),
        /** 恒为 false：这里没有建立真实 WebSocket 会话，绝不谎报已验证 */
        verified: false,
        note: "实时连接将在开始面试时再次验证。",
        unavailableReason: configured ? "" : "服务端未配置语音服务密钥，暂时无法开始面试。",
      },
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
