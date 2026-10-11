import {
  DEFAULT_VOICE,
  INTERVIEWER_GENERAL_PROMPT,
  INTERVIEW_GREETING,
  REALTIME_ASR_MODEL,
  REALTIME_MODEL,
  REALTIME_WS_BASE,
  getVoiceForInterviewer,
  normalizeInterviewDuration,
} from "@/lib/constants";
import { logger } from "@/lib/logger";
import { getRuntimeAppSettings } from "@/lib/data/settings";
import { InterviewerService } from "@/services/interviewers.service";
import { NextResponse } from "next/server";

/**
 * 签发一次实时语音会话的参数（原 Retell「注册通话」的等价物）。
 *
 * 浏览器拿到这些参数后**直连**平台 WebSocket（api_key 走查询参数，POC 已实测可行），
 * 不需要自建音频中转服务器。
 *
 * ⚠️ 安全提示：api_key 会下发到候选人浏览器。内网自用可接受，
 *   若要对外使用，应换成「服务端代理 WebSocket」方案 —— 已登记在 P1 进度文件的待确认项里。
 */

type DynamicData = {
  mins?: string | number;
  objective?: string;
  questions?: string;
  name?: string;
};

type RegisterBody = {
  dynamic_data?: DynamicData;
  interviewer_id?: number | string;
};

function renderPrompt(
  template: string,
  vars: { mins: string; name: string; objective: string; questions: string },
): string {
  return template
    .replaceAll("{{mins}}", vars.mins)
    .replaceAll("{{name}}", vars.name)
    .replaceAll("{{objective}}", vars.objective)
    .replaceAll("{{questions}}", vars.questions);
}

export async function POST(req: Request) {
  logger.info("register-call request received");

  const runtimeSettings = getRuntimeAppSettings();
  const apiKey = runtimeSettings.apiKey;
  if (!apiKey) {
    logger.error("register-call: QWEN_API_KEY 未配置");
    return NextResponse.json(
      { error: "服务端未配置 QWEN_API_KEY，无法开始语音面试" },
      { status: 500 },
    );
  }

  const body = (await req.json()) as RegisterBody;
  const data = body.dynamic_data ?? {};

  // 面试官人设决定音色。查不到就用默认音色 —— 音色填错会被服务端直接掐断连接。
  let voice = DEFAULT_VOICE;
  try {
    const interviewer = await InterviewerService.getInterviewer(Number(body.interviewer_id ?? 0));
    voice = getVoiceForInterviewer(interviewer?.name);
  } catch (error) {
    logger.error("register-call: 读取面试官失败，回落默认音色");
  }

  const questions = (data.questions || "")
    .split(", ")
    .filter(Boolean)
    .map((q, i) => `${i + 1}. ${q}`)
    .join("\n");

  const instructions = renderPrompt(INTERVIEWER_GENERAL_PROMPT, {
    // 服务端再次归一化，避免恶意或历史数据把提示词与前端计时器设成不同值。
    mins: normalizeInterviewDuration(data.mins),
    name: data.name || "候选人",
    objective: data.objective || "（未填写面试目标，请围绕候选人的经历与岗位匹配度提问）",
    questions: questions || "（未提供预设问题，请围绕面试目标自行提问）",
  });

  const model = runtimeSettings.realtimeModel || REALTIME_MODEL;

  return NextResponse.json(
    {
      callId: `call_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      wsUrl: REALTIME_WS_BASE,
      apiKey,
      model,
      voice,
      instructions,
      greeting: INTERVIEW_GREETING,
      /** 会话参数：客户端只负责下发，不要自行改动这些值（都是 POC 实测过的） */
      session: {
        modalities: ["text", "audio"],
        input_audio_format: "pcm",
        output_audio_format: "pcm",
        input_audio_transcription: { model: REALTIME_ASR_MODEL },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 800,
          interrupt_response: true,
          create_response: true,
        },
      },
    },
    { status: 200 },
  );
}
