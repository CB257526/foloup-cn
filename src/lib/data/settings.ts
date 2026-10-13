import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_INTERVIEW_DURATION_MINUTES,
  REALTIME_ASR_MODEL,
  REALTIME_MODEL,
  REALTIME_WS_BASE,
} from "@/lib/constants";
import { getDb } from "@/lib/db";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MAX_TOKENS,
  DEFAULT_LLM_MODEL,
} from "@/lib/llm-defaults";

/** 系统设置的服务端表示；任何密钥都只返回“是否已配置”，不会返回明文。 */
export interface AppSettings {
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
  apiKeyConfigured: boolean;
  realtimeApiKeyConfigured: boolean;
}

/** 运行时专用设置，包含两条链路各自的密钥，但绝不可通过 Server Action 返回给浏览器。 */
export interface RuntimeAppSettings extends AppSettings {
  apiKey: string;
  realtimeApiKey: string;
}

const LLM_SECRET_KEY = "llm_api_key";
const REALTIME_SECRET_KEY = "realtime_api_key";
/** 兼容早期版本“一把 QWEN_API_KEY 通吃所有服务”的旧密钥。 */
const LEGACY_SECRET_KEY = "qwen_api_key";

const SETTING_KEYS = [
  "llm_base_url",
  "llm_model",
  "llm_max_tokens",
  "llm_timeout_ms",
  "llm_json_mode",
  "realtime_ws_url",
  "realtime_model",
  "asr_model",
  "default_interview_duration",
  "proctoring_enabled",
  "proctoring_interval_seconds",
  "proctoring_confidence_threshold",
  LLM_SECRET_KEY,
  REALTIME_SECRET_KEY,
  LEGACY_SECRET_KEY,
] as const;

function getEncryptionKey(): Buffer {
  const configuredKey = process.env.SETTINGS_ENCRYPTION_KEY;
  if (configuredKey) {
    return createHash("sha256").update(configuredKey).digest();
  }

  // 未配置外部加密密钥时，将随机密钥放在被 Git 忽略的数据目录中，降低数据库泄露风险。
  const databasePath = process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "foloup.db");
  const keyPath = path.join(path.dirname(databasePath), "settings.key");
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });

  try {
    const key = randomBytes(32);
    fs.writeFileSync(keyPath, key, { flag: "wx", mode: 0o600 });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    return fs.readFileSync(keyPath);
  }
}

function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${encrypted.toString("base64")}`;
}

function decryptSecret(value: string): string {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) {
    return "";
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(ivText, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function readStoredSettings(): Map<string, string> {
  const placeholders = SETTING_KEYS.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(`SELECT key, value FROM app_setting WHERE key IN (${placeholders})`)
    .all(...SETTING_KEYS) as Array<{ key: string; value: string }>;

  return new Map(rows.map((row) => [row.key, row.value]));
}

function readInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function readFloat(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function hasStoredSecret(stored: Map<string, string>, key: string): boolean {
  const encrypted = stored.get(key) || "";
  return Boolean(encrypted && decryptSecret(encrypted));
}

function hasLegacySharedKey(stored: Map<string, string>): boolean {
  return Boolean(hasStoredSecret(stored, LEGACY_SECRET_KEY) || process.env.QWEN_API_KEY);
}

/** 返回不含明文密钥的设置快照，供后台设置页面使用。 */
export function getAppSettings(): AppSettings {
  const stored = readStoredSettings();

  return {
    llmBaseUrl: stored.get("llm_base_url") || process.env.LLM_BASE_URL || DEFAULT_LLM_BASE_URL,
    llmModel: stored.get("llm_model") || process.env.LLM_MODEL || DEFAULT_LLM_MODEL,
    llmMaxTokens: readInt(
      stored.get("llm_max_tokens") || process.env.LLM_MAX_TOKENS,
      DEFAULT_LLM_MAX_TOKENS,
      2000,
      32000,
    ),
    llmTimeoutMs: readInt(
      stored.get("llm_timeout_ms") || process.env.LLM_TIMEOUT_MS,
      50000,
      5000,
      120000,
    ),
    llmJsonMode: (stored.get("llm_json_mode") || process.env.LLM_JSON_MODE || "1") !== "0",
    realtimeWsUrl:
      stored.get("realtime_ws_url") || process.env.QWEN_REALTIME_WS_URL || REALTIME_WS_BASE,
    realtimeModel:
      stored.get("realtime_model") || process.env.QWEN_REALTIME_MODEL || REALTIME_MODEL,
    asrModel: stored.get("asr_model") || process.env.QWEN_REALTIME_ASR_MODEL || REALTIME_ASR_MODEL,
    defaultInterviewDuration: readInt(
      stored.get("default_interview_duration"),
      DEFAULT_INTERVIEW_DURATION_MINUTES,
      1,
      60,
    ),
    proctoringEnabled: (stored.get("proctoring_enabled") || "1") !== "0",
    proctoringIntervalSeconds: readInt(stored.get("proctoring_interval_seconds"), 30, 5, 60),
    proctoringConfidenceThreshold: readFloat(
      stored.get("proctoring_confidence_threshold"),
      0.85,
      0.5,
      1,
    ),
    apiKeyConfigured:
      hasStoredSecret(stored, LLM_SECRET_KEY) ||
      hasLegacySharedKey(stored) ||
      Boolean(process.env.LLM_API_KEY),
    realtimeApiKeyConfigured:
      hasStoredSecret(stored, REALTIME_SECRET_KEY) ||
      hasLegacySharedKey(stored) ||
      Boolean(process.env.QWEN_REALTIME_API_KEY),
  };
}

/** 仅服务端运行时调用；优先使用独立密钥，其次兼容旧版共享密钥和环境变量。 */
export function getRuntimeAppSettings(): RuntimeAppSettings {
  const settings = getAppSettings();
  const stored = readStoredSettings();
  const llmSecret = decryptSecret(stored.get(LLM_SECRET_KEY) || "");
  const realtimeSecret = decryptSecret(stored.get(REALTIME_SECRET_KEY) || "");
  const legacySecret = decryptSecret(stored.get(LEGACY_SECRET_KEY) || "");
  const environmentSharedKey = process.env.QWEN_API_KEY || process.env.LLM_API_KEY || "";

  return {
    ...settings,
    apiKey: llmSecret || legacySecret || process.env.LLM_API_KEY || environmentSharedKey,
    realtimeApiKey:
      realtimeSecret || legacySecret || process.env.QWEN_REALTIME_API_KEY || environmentSharedKey,
  };
}

/** 保存设置并分别加密文本模型和实时语音密钥；空密钥表示保留现有密钥。 */
export function saveAppSettings(input: {
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
}): void {
  const rows: Array<[string, string, number]> = [
    ["llm_base_url", input.llmBaseUrl.trim().replace(/\/+$/, ""), 0],
    ["llm_model", input.llmModel.trim(), 0],
    ["llm_max_tokens", String(input.llmMaxTokens), 0],
    ["llm_timeout_ms", String(input.llmTimeoutMs), 0],
    ["llm_json_mode", input.llmJsonMode ? "1" : "0", 0],
    ["realtime_ws_url", input.realtimeWsUrl.trim().replace(/\/+$/, ""), 0],
    ["realtime_model", input.realtimeModel.trim(), 0],
    ["asr_model", input.asrModel.trim(), 0],
    ["default_interview_duration", String(input.defaultInterviewDuration), 0],
    ["proctoring_enabled", input.proctoringEnabled ? "1" : "0", 0],
    ["proctoring_interval_seconds", String(input.proctoringIntervalSeconds), 0],
    ["proctoring_confidence_threshold", String(input.proctoringConfidenceThreshold), 0],
  ];

  if (input.llmApiKey?.trim()) {
    rows.push([LLM_SECRET_KEY, encryptSecret(input.llmApiKey.trim()), 1]);
  }
  if (input.realtimeApiKey?.trim()) {
    rows.push([REALTIME_SECRET_KEY, encryptSecret(input.realtimeApiKey.trim()), 1]);
  }

  const db = getDb();
  const statement = db.prepare(
    "INSERT INTO app_setting (key, value, is_secret, updated_at) VALUES (?, ?, ?, datetime('now')) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, updated_at = datetime('now')",
  );
  const saveTransaction = db.transaction(() => {
    for (const [key, value, isSecret] of rows) {
      statement.run(key, value, isSecret);
    }
  });
  saveTransaction();
}
