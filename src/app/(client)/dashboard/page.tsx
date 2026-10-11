import CreateInterviewCard from "@/components/dashboard/interview/createInterviewCard";
import InterviewCard from "@/components/dashboard/interview/interviewCard";
import { getAllInterviewers } from "@/lib/data/interviewers";
import { getAllInterviews } from "@/lib/data/interviews";
import { getAppSettings } from "@/lib/data/settings";

/** 数据来自 SQLite，必须在请求时读取，不能静态化 */
export const dynamic = "force-dynamic";

export default async function Interviews() {
  const [interviews, interviewers, settings] = await Promise.all([
    getAllInterviews(),
    getAllInterviewers(),
    Promise.resolve(getAppSettings()),
  ]);

  return (
    <main className="p-4 md:p-8 pt-0 mr-auto rounded-md min-w-0">
      <div className="flex flex-col items-left">
        <h2 className="mr-2 text-2xl font-semibold tracking-tight mt-8">我的岗位</h2>
        <h3 className=" text-sm tracking-tight text-gray-600 font-medium ">
          现在就开始收集候选人面试记录吧！
        </h3>
        <div className="relative flex items-center mt-1 flex-wrap">
          <CreateInterviewCard
            interviewers={interviewers}
            defaultDuration={settings.defaultInterviewDuration}
          />
          {interviews.map((item) => (
            <InterviewCard
              id={item.id}
              interviewerId={item.interviewer_id ?? 0}
              key={item.id}
              name={item.name ?? ""}
              url={item.url ?? ""}
              readableSlug={item.readable_slug ?? ""}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
