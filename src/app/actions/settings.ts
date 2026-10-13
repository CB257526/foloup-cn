"use server";

import { getAppSettings, getRuntimeAppSettings, saveAppSettings } from "@/lib/data/settings";
import { type LlmConfig, chatCompletion } from "@/lib/llm";
import { requireAdmin } from "@/lib/auth/admin";
import sharp from "sharp";

export async function getAppSettingsAction() {
  await requireAdmin();
  return getAppSettings();
}

/** 服务端校验设置，避免无效地址、过低 token 预算或异常面试时长被写入配置。 */
export async function saveAppSettingsAction(input: {
  llmBaseUrl: string;
  llmModel: string;
  llmMaxTokens: number;
  llmTimeoutMs: number;
  llmJsonMode: boolean;
  realtimeModel: string;
  defaultInterviewDuration: number;
  proctoringEnabled: boolean;
  proctoringIntervalSeconds: number;
  proctoringConfidenceThreshold: number;
  apiKey?: string;
}) {
  await requireAdmin();
  const baseUrl = new URL(input.llmBaseUrl);
  if (!/^https?:$/.test(baseUrl.protocol)) {
    throw new Error("文本模型接口地址必须使用 HTTP 或 HTTPS。");
  }
  if (!input.llmModel.trim() || !input.realtimeModel.trim()) {
    throw new Error("请填写文本模型和实时语音模型名称。");
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
  if (!Number.isInteger(input.proctoringIntervalSeconds) || input.proctoringIntervalSeconds < 5 || input.proctoringIntervalSeconds > 60) {
    throw new Error("监考截图间隔需在 5 至 60 秒之间。");
  }
  if (!Number.isFinite(input.proctoringConfidenceThreshold) || input.proctoringConfidenceThreshold < 0.5 || input.proctoringConfidenceThreshold > 1) {
    throw new Error("监考置信度阈值需在 0.5 至 1 之间。");
  }

  saveAppSettings(input);
  return getAppSettings();
}

/** 用当前已保存设置请求一次极短文本，确认地址、密钥和模型能正常工作。 */
export async function testLlmConnectionAction(input?: {
  llmBaseUrl: string;
  llmModel: string;
  llmMaxTokens: number;
  llmTimeoutMs: number;
  llmJsonMode: boolean;
  apiKey?: string;
}) {
  await requireAdmin();
  const saved = getRuntimeAppSettings();
  const config: Partial<LlmConfig> = {
    baseUrl: input?.llmBaseUrl || saved.llmBaseUrl,
    model: input?.llmModel || saved.llmModel,
    maxTokens: input?.llmMaxTokens || saved.llmMaxTokens,
    timeoutMs: input?.llmTimeoutMs || saved.llmTimeoutMs,
    jsonAllowed: input?.llmJsonMode ?? saved.llmJsonMode,
    apiKey: input?.apiKey?.trim() || saved.apiKey,
  };
  if (!config.apiKey) {
    throw new Error("请先填写并保存平台 API 密钥，再测试连接。");
  }

  await chatCompletion({
    system: "你是连通性测试助手，请严格按要求回复。",
    user: "请只回复：连接成功",
    maxTokens: 2000,
    retries: 0,
    config,
  });

  return { success: true, message: `已成功连接文本模型 ${config.model}。` };
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
