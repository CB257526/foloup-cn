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
import { getCandidateRegistrationContextByToken } from "@/lib/data/candidates";
import { getRuntimeAppSettings } from "@/lib/data/settings";
import { logger } from "@/lib/logger";
import { InterviewerService } from "@/services/interviewers.service";
import { InterviewService } from "@/services/interviews.service";
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
  questions?: string | string[];
  name?: string;
};

type RegisterBody = {
  dynamic_data?: DynamicData;
  interviewer_id?: number | string;
  interview_id?: string;
  candidate_id?: string;
  candidate_invite_token?: string;
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
  const requestedData = body.dynamic_data ?? {};
  let data = requestedData;
  let candidate: Awaited<ReturnType<typeof getCandidateRegistrationContextByToken>> = null;
  let existingCallId: string | null = null;
  let interviewId = body.interview_id || "";
  let interviewerId = Number(body.interviewer_id ?? 0);

  if (!body.candidate_id && body.interview_id) {
    const legacyInterview = await InterviewService.getInterviewById(body.interview_id);
    if (!legacyInterview || legacyInterview.id !== body.interview_id) {
      return NextResponse.json({ error: "岗位不存在" }, { status: 404 });
    }
    if (!legacyInterview.questions?.length) {
      return NextResponse.json(
        { error: "该岗位为通用模板，请使用 HR 创建的候选人专属链接" },
        { status: 409 },
      );
    }
  }

  if (body.candidate_id || body.candidate_invite_token) {
    if (!body.candidate_id || !body.candidate_invite_token || !body.interview_id) {
      return NextResponse.json({ error: "候选人专属链接参数无效" }, { status: 400 });
    }
    candidate = await getCandidateRegistrationContextByToken(
      body.candidate_invite_token,
      body.interview_id,
    );
    if (!candidate || candidate.id !== body.candidate_id) {
      return NextResponse.json({ error: "候选人专属链接已撤销或已失效" }, { status: 410 });
    }
    const interview = await InterviewService.getInterviewById(body.interview_id);
    if (!interview || interview.id !== candidate.interview_id || !interview.is_active) {
      return NextResponse.json({ error: "该岗位当前不可参加面试" }, { status: 410 });
    }
    interviewId = interview.id;
    interviewerId = interview.interviewer_id;
    existingCallId = candidate.resume_call_id;
    data = {
      mins: interview.time_duration,
      objective: interview.objective || "请围绕岗位要求与候选人经验进行专业面试。",
      questions: candidate.questions.map((question, index) => `${index + 1}. ${question.question}`),
      name: candidate.name,
    };
  }

  // 面试官人设决定音色。查不到就用默认音色 —— 音色填错会被服务端直接掐断连接。
  let voice = DEFAULT_VOICE;
  try {
    const interviewer = await InterviewerService.getInterviewer(interviewerId);
    voice = getVoiceForInterviewer(interviewer?.name);
  } catch (error) {
    logger.error("register-call: 读取面试官失败，回落默认音色");
  }

  const rawQuestions = data.questions || "";
  const questionList = Array.isArray(rawQuestions)
    ? rawQuestions.map((question: unknown) => String(question).trim()).filter(Boolean)
    : String(rawQuestions)
        .split(/\n|, /)
        .map((question) => question.trim())
        .filter(Boolean);
  const questions = questionList
    .map((question: string, index: number) =>
      /^\d+\. /.test(question) ? question : `${index + 1}. ${question}`,
    )
    .join("\n");

  const baseInstructions = renderPrompt(INTERVIEWER_GENERAL_PROMPT, {
    // 服务端再次归一化，避免恶意或历史数据把提示词与前端计时器设成不同值。
    mins: normalizeInterviewDuration(data.mins),
    name: data.name || "候选人",
    objective: data.objective || "（未填写面试目标，请围绕候选人的经历与岗位匹配度提问）",
    questions: questions || "（未提供预设问题，请围绕面试目标自行提问）",
  });
  const instructions = candidate
    ? `${baseInstructions}\n\n候选人简历背景（仅用于理解个人经历并针对事实追问，不要逐字复述）：\n${candidate.resume_text.slice(0, 30000)}`
    : baseInstructions;

  const model = runtimeSettings.realtimeModel || REALTIME_MODEL;

  return NextResponse.json(
    {
      callId: existingCallId || `call_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
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
