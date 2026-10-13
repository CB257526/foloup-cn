import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";

const COOKIE_NAME = "foloup_admin_session";
const SESSION_DAYS = 7;
const SCRYPT_LENGTH = 64;

export type AdminSession = {
  id: number;
  username: string;
  mustChangePassword: boolean;
};

function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      SCRYPT_LENGTH,
      { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, result) => (error ? reject(error) : resolve(result as Buffer)),
    );
  });
  return derived.toString("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export async function ensureInitialAdmin(): Promise<void> {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM admin_account LIMIT 1").get();
  if (existing) return;

  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword("admin", salt);
  db.prepare(
    `INSERT OR IGNORE INTO admin_account
     (username, password_hash, password_salt, must_change_password)
     VALUES ('admin', ?, ?, 1)`,
  ).run(passwordHash, salt);
}

export async function verifyAdminCredentials(
  username: string,
  password: string,
): Promise<{ id: number; username: string; mustChangePassword: boolean } | null> {
  await ensureInitialAdmin();
  const row = getDb()
    .prepare(
      `SELECT id, username, password_hash, password_salt, must_change_password, is_active
       FROM admin_account WHERE username = ? LIMIT 1`,
    )
    .get(username.trim()) as
    | {
        id: number;
        username: string;
        password_hash: string;
        password_salt: string;
        must_change_password: number;
        is_active: number;
      }
    | undefined;

  if (!row || row.is_active !== 1) return null;
  const candidate = await hashPassword(password, row.password_salt);
  if (!safeEqualHex(candidate, row.password_hash)) return null;
  return {
    id: row.id,
    username: row.username,
    mustChangePassword: row.must_change_password === 1,
  };
}

export function createAdminSession(adminId: number): string {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  getDb()
    .prepare("INSERT INTO auth_session (admin_id, token_hash, expires_at) VALUES (?, ?, ?)")
    .run(adminId, digestToken(token), expiresAt);
  return token;
}

export function revokeAdminSession(token: string): void {
  if (!token) return;
  getDb()
    .prepare("UPDATE auth_session SET revoked_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL")
    .run(digestToken(token));
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token || token.length > 100) return null;

  const row = getDb()
    .prepare(
      `SELECT a.id, a.username, a.must_change_password
       FROM auth_session s JOIN admin_account a ON a.id = s.admin_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL
         AND s.expires_at > datetime('now') AND a.is_active = 1 LIMIT 1`,
    )
    .get(digestToken(token)) as
    | { id: number; username: string; must_change_password: number }
    | undefined;
  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    mustChangePassword: row.must_change_password === 1,
  };
}

export async function requireAdmin(): Promise<AdminSession> {
  const admin = await getAdminSession();
  if (!admin) redirect("/login");
  if (admin.mustChangePassword) redirect("/change-password");
  return admin;
}

export async function changeAdminPassword(
  adminId: number,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 12 || newPassword.length > 128) {
    throw new Error("新密码长度必须为 12 至 128 个字符。");
  }
  const row = getDb()
    .prepare("SELECT password_hash, password_salt FROM admin_account WHERE id = ? LIMIT 1")
    .get(adminId) as { password_hash: string; password_salt: string } | undefined;
  if (!row) throw new Error("管理员账号不存在。");

  const currentHash = await hashPassword(currentPassword, row.password_salt);
  if (!safeEqualHex(currentHash, row.password_hash)) throw new Error("当前密码不正确。");

  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(newPassword, salt);
  const db = getDb();
  const update = db.transaction(() => {
    db.prepare(
      `UPDATE admin_account SET password_hash = ?, password_salt = ?,
       must_change_password = 0 WHERE id = ?`,
    ).run(passwordHash, salt, adminId);
    db.prepare("UPDATE auth_session SET revoked_at = datetime('now') WHERE admin_id = ? AND revoked_at IS NULL")
      .run(adminId);
  });
  update.immediate();
}

export function adminCookieName(): string {
  return COOKIE_NAME;
}

export function adminSessionDays(): number {
  return SESSION_DAYS;
}
