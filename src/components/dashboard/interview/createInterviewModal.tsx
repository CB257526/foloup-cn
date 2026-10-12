"use client";

import DetailsPopup from "@/components/dashboard/interview/create-popup/details";
import type { Interviewer } from "@/types/interviewer";

interface Props {
  open: boolean;
  setOpen: (open: boolean) => void;
  interviewers: Interviewer[];
  defaultDuration?: number;
}

/** 新建岗位只保存可复用模板，不在岗位创建阶段要求HR提供个人简历。 */
function CreateInterviewModal({ open, setOpen, interviewers, defaultDuration }: Props) {
  return (
    <DetailsPopup
      open={open}
      setOpen={setOpen}
      interviewers={interviewers}
      defaultDuration={defaultDuration}
    />
  );
}

export default CreateInterviewModal;
