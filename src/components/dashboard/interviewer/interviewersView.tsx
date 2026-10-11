"use client";

import CreateInterviewerButton from "@/components/dashboard/interviewer/createInterviewerButton";
import InterviewerCard from "@/components/dashboard/interviewer/interviewerCard";
import type { Interviewer } from "@/types/interviewer";
import { ChevronLeft } from "lucide-react";
import { ChevronRight } from "lucide-react";
import React from "react";

/**
 * 原 `dashboard/interviewers/page.tsx` 的客户端部分（左右滑动按钮）。
 * 数据改由服务端页面 `await getAllInterviewers()` 传入，外观与布局未变。
 */
function InterviewersView({ interviewers }: { interviewers: Interviewer[] }) {
  const slideLeft = () => {
    const slider = document.getElementById("slider");
    if (slider) {
      slider.scrollLeft = slider.scrollLeft - 190;
    }
  };

  const slideRight = () => {
    const slider = document.getElementById("slider");
    if (slider) {
      slider.scrollLeft = slider.scrollLeft + 190;
    }
  };

  return (
    <main className="p-8 pt-0 ml-12 mr-auto rounded-md">
      <div className="flex flex-col items-left">
        <div className="flex flex-row mt-5">
          <div>
            <h2 className="mr-2 text-2xl font-semibold tracking-tight mt-3">面试官</h2>
            <h3 className=" text-sm tracking-tight text-gray-600 font-medium ">
              点击头像了解他们。
            </h3>
          </div>
        </div>
        <div className="relative flex items-center mt-2 ">
          <div
            id="slider"
            className=" h-44 pt-2 overflow-x-scroll scroll whitespace-nowrap scroll-smooth scrollbar-hide w-[40rem]"
          >
            {interviewers.length === 0 ? <CreateInterviewerButton /> : <></>}
            {interviewers.map((interviewer) => (
              <InterviewerCard key={interviewer.id} interviewer={interviewer} />
            ))}
          </div>
          {interviewers.length > 4 ? (
            <div className="flex-row justify-center items-center space-y-10">
              <ChevronRight
                className="opacity-50 cursor-pointer hover:opacity-100"
                size={40}
                onClick={slideRight}
              />
              <ChevronLeft
                className="opacity-50 cursor-pointer hover:opacity-100"
                size={40}
                onClick={() => slideLeft()}
              />
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
    </main>
  );
}

export default InterviewersView;
