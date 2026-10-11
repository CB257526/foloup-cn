/**
 * 候选人知情同意 + 数据留存期限 —— 客户端工具（P3 名下，新建文件）
 *
 * 为什么在「页面层」而不是通话组件里：
 *   P1 的通话组件（`src/components/call/**`）已在验收中声明「内部不涉及合规交互」，
 *   且接口已冻结（见 `进度/P1-语音层.md` 第 4 节）。所以同意环节做在 `<Call>` **之前**。
 *
 * 合规依据（中国《个人信息保护法》）：
 *   · 声音（语音）属于**敏感个人信息**，处理需取得**单独同意** —— 不能靠笼统的用户协议兜住；
 *   · 需向个人说明处理目的（录音/转录用途）、保存期限、谁能看、如何删除；
 *   · 自动化决策（AI 初筛）需保证透明与结果公平，就业歧视的举证责任在企业
 *     ⇒ 页面上必须写明「AI 仅辅助初筛，最终决定由人工做出」。
 *
 * ⚠️ 本文件只做**客户端记录**（localStorage）。服务端留痕（同意的审计证据）需要
 *    数据层加表/加列，属 P0/主控名下文件 —— 已写进 进度/P3-候选人体验与合规.md「阻塞与待确认」。
 */

/** 同意文案版本号：文案一改就要升版本，旧版本记录不再视为有效同意 */
export const CONSENT_VERSION = "2026-10-11.v1";

/** localStorage 键前缀（按岗位隔离：重开面试链接不必重复同意同一个岗位） */
const STORAGE_PREFIX = "foloup.consent.";

/** 默认留存期限（月）。可用 NEXT_PUBLIC_DATA_RETENTION_MONTHS 覆盖 */
const DEFAULT_RETENTION_MONTHS = 6;

export type ConsentRecord = {
  /** 同意文案版本 */
  version: string;
  /** 岗位 id（interview.id，不是 URL 里的 readable_slug） */
  interviewId: string;
  /** 岗位名，便于人工核对 */
  interviewName: string;
  /** 同意时间（ISO 8601，本地时钟） */
  agreedAt: string;
  /** ① 单独同意：声音等敏感个人信息（必选） */
  sensitiveDataAgreed: boolean;
  /** ② 已阅读并知悉留存期限与删除方式（必选） */
  retentionAgreed: boolean;
  /** ③ 可选：去标识化后用于面试流程改进（不勾也能面试） */
  optionalImproveAgreed: boolean;
  /** 设备信息，供人工排查（不用于画像） */
  userAgent: string;
};

function storageKey(interviewId: string): string {
  return `${STORAGE_PREFIX}${interviewId}`;
}

/**
 * 读取同意记录。localStorage 在隐私模式 / 禁用 cookie 的环境会抛异常，
 * 这里一律吞掉并返回 null（表现为「需要重新同意」——宁可多问一次，不可漏问）。
 */
export function readConsent(interviewId: string): ConsentRecord | null {
  if (!interviewId || typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey(interviewId));

    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as ConsentRecord;

    // 版本不一致 ⇒ 视为未同意
    return parsed && parsed.version === CONSENT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function saveConsent(record: ConsentRecord): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey(record.interviewId), JSON.stringify(record));
  } catch {
    // 存不下也不拦人：同意动作仍然发生过（只是刷新后需要再点一次）
  }
}

export function clearConsent(interviewId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(storageKey(interviewId));
  } catch {
    // 忽略
  }
}

/** 留存期限（月）。非法值一律回退到默认 6 个月 */
export function getRetentionMonths(): number {
  const raw = process.env.NEXT_PUBLIC_DATA_RETENTION_MONTHS;
  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_RETENTION_MONTHS;
}

/** 按「月」推到期日（自然月，日对齐） */
export function retentionDeadline(from: Date, months: number = getRetentionMonths()): Date {
  const d = new Date(from.getTime());

  d.setMonth(d.getMonth() + months);

  return d;
}

/** 中文日期（YYYY年M月D日） */
export function formatCnDate(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 外部配置（可选）：候选人可联系的人工/隐私联系邮箱、平台隐私政策说明 */
export function getPrivacyContactEmail(): string {
  return (process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL || "").trim();
}
