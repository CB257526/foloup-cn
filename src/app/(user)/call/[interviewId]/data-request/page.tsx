import { getInterviewById } from "@/lib/data/interviews";
import {
  deleteResponse,
  getAllEmailAddressesForInterview,
  getAllResponses,
} from "@/lib/data/responses";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatCnDate, getPrivacyContactEmail, getRetentionMonths, retentionDeadline } from "../consent";

/**
 * 候选人「数据删除申请 / 自助删除」页（P3 名下，新建页面）
 *
 * 合规依据（中国《个人信息保护法》第 47 条）：个人有权请求删除其个人信息，
 * 处理者应当主动删除 —— 所以这里给候选人一条**可自助使用**的删除通路。
 *
 * 实现方式与边界：
 *   · 本页是**服务端组件**，内联一个 Server Action 完成删除；
 *   · 只 import 已冻结的数据层（`src/lib/data/**`）的既有函数，**未修改任何他人文件**；
 *   · 判定依据：候选人填写的邮箱必须与记录里的邮箱完全一致（去空格、忽略大小写）；
 *   · 删除范围：与「本岗位 + 该邮箱」关联的**已完成**面试记录（逐字稿、AI 评分、姓名邮箱、过程指标）。
 *     尚未结束的记录不在自助范围内（数据层的 `getAllResponses` 只返回 `is_ended = 1` 的行）——
 *     这类情况页面会明确提示走人工处理，不会假装删掉了。
 *
 * ⚠️ 已知取舍：本页在公网是**无鉴权**的（和整个候选人链路一样），
 *    因此自助删除只以「知道本岗位链接 + 知道该邮箱」作为身份校验。
 *    真实上线是否收紧（改成提交申请 + HR 复核执行），已写进 进度/P3-候选人体验与合规.md「阻塞与待确认」。
 */

export const metadata = {
  title: "数据删除申请",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ interviewId: string }>;
  searchParams: Promise<{ done?: string; count?: string; error?: string }>;
};

/** 与候选人页同源的解码逻辑（缺陷 D-1：URL 里的中文岗位名是百分号编码态） */
function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const ERROR_TEXT: Record<string, string> = {
  invalid: "这个链接无效，请确认你打开的是收到的面试邀请链接。",
  email: "请输入有效的邮箱地址（必须与面试时填写的邮箱一致）。",
  confirm: "请先勾选下方的确认项。",
  notfound: "没有找到与该邮箱匹配的面试记录。请确认邮箱是否与面试时填写的一致。",
  unfinished:
    "找到你的面试记录，但这条记录还没有完成，无法自助删除。请联系发送面试邀请的招聘人员处理。",
};

export default async function DataRequestPage({ params, searchParams }: Props) {
  const { interviewId: rawId } = await params;
  const interviewId = decodeParam(rawId);
  const resolvedSearchParams = await searchParams;

  const interview = await getInterviewById(interviewId);
  const canonicalId = interview?.id ?? null;
  const months = getRetentionMonths();
  const contactEmail = getPrivacyContactEmail();
  const basePath = `/call/${encodeURIComponent(interviewId)}/data-request`;
  const backHref = `/call/${encodeURIComponent(interview?.readable_slug || interviewId)}`;

  /**
   * 自助删除。邮箱不一致 → 什么都不做（不泄露"该邮箱是否存在"以外的信息）。
   * ⚠️ 删除不可恢复：数据层是 `DELETE FROM response WHERE call_id = ?`。
   */
  async function deleteMyData(formData: FormData) {
    "use server";

    if (!canonicalId) {
      redirect(`${basePath}?error=invalid`);
    }

    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const confirmed = formData.get("confirm") === "on";

    if (!email || !email.includes("@")) {
      redirect(`${basePath}?error=email`);
    }
    if (!confirmed) {
      redirect(`${basePath}?error=confirm`);
    }

    const rows = await getAllResponses(canonicalId);
    const targets = rows.filter((r) => (r.email ?? "").trim().toLowerCase() === email);

    if (targets.length === 0) {
      // 区分「没有这条记录」与「记录还没结束」——后者不能装作删掉了
      const allEmails = await getAllEmailAddressesForInterview(canonicalId);
      const hasUnfinished = allEmails.some(
        (item) => (item.email ?? "").trim().toLowerCase() === email,
      );

      redirect(`${basePath}?error=${hasUnfinished ? "unfinished" : "notfound"}`);
    }

    let deleted = 0;
    for (const target of targets) {
      if (target.call_id) {
        await deleteResponse(target.call_id);
        deleted += 1;
      }
    }

    // 留痕（服务端日志）。⚠️ 真正的审计表需要数据层加表 —— 已写进进度文件「阻塞与待确认」
    console.info(
      `[P3·候选人数据删除] interview=${canonicalId} email=${email} deleted=${deleted} at=${new Date().toISOString()}`,
    );

    redirect(`${basePath}?done=1&count=${deleted}`);
  }

  const errorCode = resolvedSearchParams.error;
  const errorText = errorCode ? ERROR_TEXT[errorCode] ?? "操作失败，请稍后重试。" : "";
  const doneCount = Number(resolvedSearchParams.count ?? "0");
  const isDone = resolvedSearchParams.done === "1";

  return (
    <div className="candidate-shell">
      <div className="mx-auto w-full max-w-[720px] p-3 sm:p-6">
        <div className="rounded-xl border-2 border-b-4 border-r-4 border-black bg-white p-4 sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {interview?.name ?? "AI 面试"}
          </p>
          <h1 className="mt-1 text-xl font-bold sm:text-2xl">数据删除申请</h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-700">
            你可以在这里删除自己在本次面试中留下的个人信息。删除是
            <strong>立即生效且不可恢复</strong>的，请确认后再操作。
          </p>

          {isDone && (
            <div
              data-testid="delete-done"
              className="mt-5 rounded-lg border-2 border-green-300 bg-green-50 p-4 text-sm leading-relaxed text-gray-800"
            >
              <p className="font-semibold">已删除 {doneCount} 条与该邮箱关联的面试记录。</p>
              <p className="mt-1">
                逐字稿、AI 评分与评语、姓名与邮箱、面试过程指标均已从数据库中删除。
                你可以关闭本页面了。
              </p>
            </div>
          )}

          {errorText && (
            <div
              data-testid="delete-error"
              className="mt-5 rounded-lg border-2 border-red-300 bg-red-50 p-4 text-sm leading-relaxed text-gray-800"
            >
              {errorText}
            </div>
          )}

          {/* ── 本系统保存了什么 ── */}
          <section className="mt-5 rounded-lg border border-indigo-100 bg-gray-50 p-4">
            <h2 className="text-sm font-bold text-gray-900">本系统保存了你的什么</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-700">
              <li>面试对话的<strong>文字转录稿（逐字稿）</strong></li>
              <li>AI 初筛的<strong>评分与评语</strong></li>
              <li>你填写的<strong>姓名与邮箱</strong>，以及面试时长等过程指标</li>
              <li className="text-gray-600">
                本系统<strong>不保存通话录音音频文件</strong>（不做录音存储），因此这里能删除的是文字与评分记录。
              </li>
            </ul>
          </section>

          {/* ── 留存期限 ── */}
          <section className="mt-4 rounded-lg border border-indigo-100 bg-gray-50 p-4">
            <h2 className="text-sm font-bold text-gray-900">保存期限</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-700">
              即使你不主动申请删除，你的面试记录也会在
              <strong> 自面试结束之日起 {months} 个月 </strong>
              后删除。按今天推算的到期日约为 {formatCnDate(retentionDeadline(new Date(), months))}。
            </p>
          </section>

          {/* ── 删除表单 ── */}
          <section className="mt-5 rounded-lg border-2 border-red-200 bg-white p-4">
            <h2 className="text-sm font-bold text-gray-900">立即删除我的面试数据</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-700">
              为了确认是你本人，请输入<strong>面试时填写的邮箱</strong>。邮箱不一致时不会删除任何数据。
            </p>
            <form action={deleteMyData} className="mt-4 space-y-3">
              <label className="block text-sm font-semibold text-gray-800" htmlFor="email">
                面试时填写的邮箱
              </label>
              <input
                id="email"
                name="email"
                data-testid="delete-email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                placeholder="name@example.com"
                className="h-11 w-full rounded-md border-2 border-gray-300 px-3 text-sm font-normal"
              />
              <label
                htmlFor="confirm"
                className="flex cursor-pointer items-start gap-3 text-sm font-normal leading-relaxed text-gray-800"
              >
                <input
                  id="confirm"
                  name="confirm"
                  data-testid="delete-confirm"
                  type="checkbox"
                  className="mt-[2px] h-5 w-5 shrink-0 accent-red-600"
                />
                <span>
                  我确认这是本人的面试记录，并知悉<strong>删除后无法恢复</strong>，
                  招聘方将无法再查看这次面试的转录与评分。
                </span>
              </label>
              <button
                type="submit"
                data-testid="delete-submit"
                className="h-11 w-full rounded-lg bg-red-600 text-base font-semibold text-white sm:w-auto sm:px-6"
              >
                确认删除我的面试数据（不可恢复）
              </button>
            </form>
          </section>

          {/* ── 人工通道 ── */}
          <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-bold text-gray-900">如果你希望由人工处理</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-700">
              {contactEmail ? (
                <>
                  你可以直接发邮件至 <strong>{contactEmail}</strong>
                  ，说明你的姓名与面试岗位，我们会为你处理删除。
                </>
              ) : (
                <>请联系发送面试邀请的招聘人员，说明你的姓名与面试岗位，我们会为你处理删除。</>
              )}
            </p>
          </section>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {interview && (
              <Link
                href={backHref}
                className="flex h-11 w-full items-center justify-center rounded-lg border-2 border-indigo-600 bg-white text-sm font-semibold text-indigo-700 sm:w-auto sm:px-6"
              >
                返回面试页面
              </Link>
            )}
            <span className="flex h-11 w-full items-center justify-center text-xs text-gray-500 sm:w-auto">
              删除请求会记录在服务端日志中，便于事后核查。
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
