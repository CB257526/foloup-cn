import InterviewDetailView from "@/components/dashboard/interview/interviewDetailView";
import { getAllInterviewers } from "@/lib/data/interviewers";
import { getInterviewById } from "@/lib/data/interviews";
import { getAllResponses } from "@/lib/data/responses";
import type { Response } from "@/types/response";

/** 数据来自 SQLite，必须在请求时读取，不能静态化 */
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{
    interviewId: string;
  }>;
  searchParams: Promise<{
    call?: string;
    edit?: string;
  }>;
}

export default async function InterviewHome({ params, searchParams }: Props) {
  const { interviewId } = await params;
  const { call, edit } = await searchParams;

  const [interview, responses, interviewers] = await Promise.all([
    getInterviewById(interviewId),
    getAllResponses(interviewId),
    getAllInterviewers(),
  ]);

  return (
    <InterviewDetailView
      interviewId={interviewId}
      callId={call}
      edit={edit === "true"}
      interview={interview}
      // SQLite 的 response.id 是 number，而 types/response.ts（P1 名下）仍声明为 bigint（Postgres 遗留）。
      // 运行时值是 number，可正常序列化给客户端组件；这里只在类型边界上做一次转换。
      responses={responses as unknown as Response[]}
      interviewers={interviewers}
    />
  );
}
