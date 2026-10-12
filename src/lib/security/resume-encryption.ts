import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 简历文本属于个人信息，单独使用本地 256 位密钥加密后再写入 SQLite。 */
function getResumeKey(): Buffer {
  const databasePath = process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "foloup.db");
  const keyPath = path.join(path.dirname(databasePath), "resume-data.key");
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });

  try {
    const key = randomBytes(32);
    fs.writeFileSync(keyPath, key, { flag: "wx", mode: 0o600 });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const key = fs.readFileSync(keyPath);
    if (key.length !== 32) {
      throw new Error("简历加密密钥格式错误，请从安全备份恢复 resume-data.key");
    }
    return key;
  }
}

/** 使用 AES-GCM 加密简历正文，附带随机 IV 与认证标签。 */
export function encryptResumeText(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getResumeKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${encrypted.toString("base64")}`;
}

/** 读取 HR 候选人记录时解密；旧版明文内容也允许迁移后继续显示。 */
export function decryptResumeText(value: string): string {
  if (!value.startsWith("v1.")) {
    return value;
  }
  const [, ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) {
    throw new Error("简历加密内容格式错误");
  }

  const decipher = createDecipheriv("aes-256-gcm", getResumeKey(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
