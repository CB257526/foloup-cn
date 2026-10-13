/**
 * 候选人知情同意 + 数据留存期限 —— 客户端工具（P3 名下新建，本次 P2 后续改造修订）
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
 * ⚠️ 本文件只做**客户端便利记录**（localStorage），用于「同一设备重开链接时少读一遍说明」。
 *    它**不是**审计数据库：真正的同意留痕在服务端
 *    （`src/lib/data/consents.ts` + `consent_record` 表，按专属令牌写入）。
 *    因此：
 *      · 文案版本号不再是这里的常量，而是服务端下发的 `ConsentPolicy.version`；
 *      · user-agent 由服务端从请求头读取并压缩成摘要，客户端不再采集、也不再上报。
 */

/** localStorage 键前缀（按候选人/岗位隔离） */
const STORAGE_PREFIX = "foloup.consent.";

export type ConsentRecord = {
  /** 同意文案版本（来自服务端下发的策略，不是本地常量） */
  version: string;
  /** 岗位 id（interview.id，不是 URL 里的 readable_slug） */
  interviewId: string;
  /** 岗位名，便于人工核对 */
  interviewName: string;
  /** 同意时间（ISO 8601，本地时钟；服务端另有一份权威时间） */
  agreedAt: string;
  /** ① 单独同意：语音（敏感个人信息）上传至国内大模型语音服务（必选） */
  voiceProcessingAccepted: boolean;
  /** ② 同意生成文字转录与 AI 初筛评分，并知悉留存期限/可见范围/删除方式（必选） */
  evaluationAccepted: boolean;
  /** ③ 可选：去标识化后用于面试流程改进 */
  improvementAccepted: boolean;
};

function storageKey(interviewId: string, scope?: string): string {
  return `${STORAGE_PREFIX}${scope || interviewId}`;
}

/**
 * 读取本地同意记录。
 * localStorage 在隐私模式 / 禁用 cookie 的环境会抛异常，这里一律吞掉并返回 null
 * （表现为「需要重新同意」—— 宁可多问一次，不可漏问）。
 *
 * `expectedVersion` 由服务端下发：版本不一致 ⇒ 视为未同意（文案改版后旧同意不作数）。
 */
export function readConsent(
  interviewId: string,
  scope: string | undefined,
  expectedVersion: string,
): ConsentRecord | null {
  if (!interviewId || !expectedVersion || typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey(interviewId, scope));

    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as ConsentRecord;

    return parsed && parsed.version === expectedVersion ? parsed : null;
  } catch {
    return null;
  }
}

export function saveConsent(record: ConsentRecord, scope?: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey(record.interviewId, scope), JSON.stringify(record));
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

/** 按「月」推到期日（自然月，日对齐）—— 月数由服务端策略传入，避免前后端各算一套 */
export function retentionDeadline(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getDate();

  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));

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
