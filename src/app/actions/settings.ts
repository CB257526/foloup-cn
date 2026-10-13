"use server";

import { requireAdmin } from "@/lib/auth/admin";
import { REALTIME_ASR_MODEL } from "@/lib/constants";
import { getAppSettings, getRuntimeAppSettings, saveAppSettings } from "@/lib/data/settings";
import { type LlmConfig, chatCompletion } from "@/lib/llm";
import sharp from "sharp";

export async function getAppSettingsAction() {
  await requireAdmin();
  return getAppSettings();
}

function validateHttpUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}格式不正确，请填写完整地址。`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label}必须使用 HTTP 或 HTTPS。`);
  }
}

function validateWebSocketUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}格式不正确，请填写完整的 WebSocket 地址。`);
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`${label}必须使用 ws:// 或 wss://。`);
  }
}

/** 服务端校验设置，确保页面保存的每个字段都能进入对应运行链路。 */
export async function saveAppSettingsAction(input: {
  llmBaseUrl: string;
  llmModel: string;
  llmMaxTokens: number;
  llmTimeoutMs: number;
  llmJsonMode: boolean;
  realtimeWsUrl: string;
  realtimeModel: string;
  asrModel: string;
  defaultInterviewDuration: number;
  proctoringEnabled: boolean;
  proctoringIntervalSeconds: number;
  proctoringConfidenceThreshold: number;
  llmApiKey?: string;
  realtimeApiKey?: string;
}) {
  await requireAdmin();
  validateHttpUrl(input.llmBaseUrl, "文本模型接口地址");
  validateWebSocketUrl(input.realtimeWsUrl, "实时语音 WebSocket 地址");

  if (!input.llmModel.trim() || !input.realtimeModel.trim() || !input.asrModel.trim()) {
    throw new Error("请填写文本模型、实时语音模型和 ASR 模型名称。");
  }
  if (
    !Number.isInteger(input.llmMaxTokens) ||
    input.llmMaxTokens < 2000 ||
    input.llmMaxTokens > 32000
  ) {
    throw new Error("最大输出 Token 需在 2000 至 32000 之间。");
  }
  if (
    !Number.isInteger(input.llmTimeoutMs) ||
    input.llmTimeoutMs < 5000 ||
    input.llmTimeoutMs > 120000
  ) {
    throw new Error("请求超时需在 5000 至 120000 毫秒之间。");
  }
  if (
    !Number.isInteger(input.defaultInterviewDuration) ||
    input.defaultInterviewDuration < 1 ||
    input.defaultInterviewDuration > 60
  ) {
    throw new Error("默认面试时长需在 1 至 60 分钟之间。");
  }
  if (
    !Number.isInteger(input.proctoringIntervalSeconds) ||
    input.proctoringIntervalSeconds < 5 ||
    input.proctoringIntervalSeconds > 60
  ) {
    throw new Error("监考截图间隔需在 5 至 60 秒之间。");
  }
  if (
    !Number.isFinite(input.proctoringConfidenceThreshold) ||
    input.proctoringConfidenceThreshold < 0.5 ||
    input.proctoringConfidenceThreshold > 1
  ) {
    throw new Error("监考置信度阈值需在 0.5 至 1 之间。");
  }

  saveAppSettings(input);
  return getAppSettings();
}

/** 用当前或页面暂存的文本模型配置请求一次短文本，验证地址、密钥和模型确实可用。 */
export async function testLlmConnectionAction(input?: {
  llmBaseUrl: string;
  llmModel: string;
  llmMaxTokens: number;
  llmTimeoutMs: number;
  llmJsonMode: boolean;
  llmApiKey?: string;
}) {
  await requireAdmin();
  const saved = getRuntimeAppSettings();
  const config: Partial<LlmConfig> = {
    baseUrl: input?.llmBaseUrl || saved.llmBaseUrl,
    model: input?.llmModel || saved.llmModel,
    maxTokens: input?.llmMaxTokens || saved.llmMaxTokens,
    timeoutMs: input?.llmTimeoutMs || saved.llmTimeoutMs,
    jsonAllowed: input?.llmJsonMode ?? saved.llmJsonMode,
    apiKey: input?.llmApiKey?.trim() || saved.apiKey,
  };
  if (!config.apiKey) {
    throw new Error("请先填写并保存文本模型 API 密钥，再测试连接。");
  }
  validateHttpUrl(config.baseUrl || "", "文本模型接口地址");

  await chatCompletion({
    system: "你是连通性测试助手，请严格按要求回复。",
    user: "请只回复：连接成功",
    maxTokens: 2000,
    retries: 0,
    config,
  });

  return { success: true, message: `已成功连接文本模型 ${config.model}。` };
}

function createRealtimeTestUrl(wsUrl: string, model: string, apiKey: string): string {
  const url = new URL(wsUrl);
  url.searchParams.set("model", model);
  // 当前浏览器直连方案沿用项目 POC 验证过的查询参数鉴权方式。
  url.searchParams.set("api_key", apiKey);
  return url.toString();
}

/**
 * 真实建立一次实时 WebSocket，并发送 session.update 验证 ASR 模型字段。
 * 只验证握手和会话参数，不发送候选人音频，也不会创建正式面试记录。
 */
export async function testRealtimeConnectionAction(input?: {
  realtimeWsUrl: string;
  realtimeModel: string;
  asrModel: string;
  realtimeApiKey?: string;
}) {
  await requireAdmin();
  const saved = getRuntimeAppSettings();
  const wsUrl = input?.realtimeWsUrl || saved.realtimeWsUrl;
  const model = input?.realtimeModel || saved.realtimeModel;
  const asrModel = input?.asrModel || saved.asrModel || REALTIME_ASR_MODEL;
  const apiKey = input?.realtimeApiKey?.trim() || saved.realtimeApiKey;

  validateWebSocketUrl(wsUrl, "实时语音 WebSocket 地址");
  if (!model.trim() || !asrModel.trim()) {
    throw new Error("请先填写实时语音模型和 ASR 模型名称。");
  }
  if (!apiKey) {
    throw new Error("请先填写并保存实时语音 API 密钥，再测试连接。");
  }
  if (typeof WebSocket === "undefined") {
    throw new Error("当前服务端运行时不支持 WebSocket，无法进行实时语音测试。");
  }

  const socket = new WebSocket(createRealtimeTestUrl(wsUrl, model, apiKey));
  const timeoutMs = 15000;

  return new Promise<{ success: true; message: string }>((resolve, reject) => {
    let settled = false;
    let opened = false;
    const timer = setTimeout(() => {
      finishError(`实时语音连接测试超时（>${timeoutMs}ms），请检查 WebSocket 地址、模型和网络。`);
    }, timeoutMs);

    const closeSocket = () => {
      try {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1000, "settings-test");
        }
      } catch {
        // 测试结束时关闭连接失败不会影响已经得到的测试结论。
      }
    };

    const finishSuccess = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      closeSocket();
      resolve({
        success: true,
        message: `实时语音连接成功，ASR 模型 ${asrModel} 已被服务端接受。`,
      });
    };

    function finishError(message: string) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      closeSocket();
      reject(new Error(message));
    }

    socket.onopen = () => {
      opened = true;
      socket.send(
        JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            input_audio_format: "pcm",
            output_audio_format: "pcm",
            input_audio_transcription: { model: asrModel },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 800,
              interrupt_response: true,
              create_response: true,
            },
          },
        }),
      );
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      try {
        const data = JSON.parse(event.data) as { type?: string; error?: { message?: string } };
        if (data.type === "error") {
          finishError(`实时语音服务拒绝会话参数：${data.error?.message || "未知错误"}`);
          return;
        }
        if (data.type === "session.created" || data.type === "session.updated") {
          finishSuccess();
        }
      } catch {
        // 非 JSON 消息不影响后续等待 session.created/session.updated。
      }
    };

    socket.onerror = () => {
      finishError(
        opened
          ? "实时语音连接已建立，但会话参数发送失败。"
          : "无法连接实时语音服务，请检查 WebSocket 地址、API 密钥和网络。",
      );
    };

    socket.onclose = (event) => {
      if (!settled) {
        finishError(`实时语音连接被关闭（code ${event.code}），请检查服务商接口配置。`);
      }
    };
  });
}

/** 使用系统当前配置的多模态模型验证图像输入能力。 */
export async function testLlmVisionAction() {
  await requireAdmin();
  const samplePng = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#4f46e5" },
  })
    .png()
    .toBuffer();
  const sample = `data:image/png;base64,${samplePng.toString("base64")}`;
  await chatCompletion({
    system: "请根据图片内容回答问题。",
    user: "图中是否有一个白色圆形？请只回答是或否。",
    imageDataUrl: sample,
    maxTokens: 2000,
    retries: 0,
  });
  return { success: true, message: "当前配置的模型已成功接收测试图片。" };
}
