import InterviewersView from "@/components/dashboard/interviewer/interviewersView";
import { getAllInterviewers } from "@/lib/data/interviewers";

/** 数据来自 SQLite，必须在请求时读取，不能静态化 */
export const dynamic = "force-dynamic";

export default async function InterviewersPage() {
  const interviewers = await getAllInterviewers();

  return <InterviewersView interviewers={interviewers} />;
}
