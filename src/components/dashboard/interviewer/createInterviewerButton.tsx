"use client";

import { Card, CardContent } from "@/components/ui/card";
import { InterviewerService } from "@/services/interviewers.service";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * 原版：`axios.get("/api/create-interviewer")` —— 那个路由是 Retell 版（境外语音栈），
 * 会在服务端建两个 Retell agent。现改为直接调 Server Action 建两个默认面试官。
 */
function CreateInterviewerButton() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const createInterviewers = async () => {
    setIsLoading(true);
    try {
      await InterviewerService.ensureDefaultInterviewers();
      router.refresh();
    } catch (error) {
      console.error("Failed to create default interviewers:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Card
        className="p-0 inline-block cursor-pointer hover:scale-105 ease-in-out duration-300 h-40 w-36 ml-1 mr-3 rounded-xl shrink-0 overflow-hidden shadow-md"
        onClick={() => createInterviewers()}
      >
        <CardContent className="p-0">
          {isLoading ? (
            <div className="w-full h-20 overflow-hidden flex justify-center items-center">
              <Loader2 size={40} className="animate-spin" />
            </div>
          ) : (
            <div className="w-full h-20 overflow-hidden flex justify-center items-center">
              <Plus size={40} />
            </div>
          )}
          <p className="my-3 mx-auto text-xs text-wrap w-fit text-center">
            创建两个默认面试官
          </p>
        </CardContent>
      </Card>
    </>
  );
}

export default CreateInterviewerButton;
