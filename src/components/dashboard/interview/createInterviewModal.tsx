"use client";

import DetailsPopup from "@/components/dashboard/interview/create-popup/details";
import QuestionsPopup from "@/components/dashboard/interview/create-popup/questions";
import LoaderWithLogo from "@/components/loaders/loader-with-logo/loaderWithLogo";
import type { InterviewBase } from "@/types/interview";
import type { Interviewer } from "@/types/interviewer";
import { DEFAULT_INTERVIEW_DURATION_MINUTES } from "@/lib/constants";
import React, { useEffect, useState } from "react";

interface Props {
  open: boolean;
  setOpen: (open: boolean) => void;
  interviewers: Interviewer[];
  defaultDuration?: number;
}

/** 单租户：已删 user_id / organization_id */
const CreateEmptyInterviewData = (
  defaultDuration = DEFAULT_INTERVIEW_DURATION_MINUTES,
): InterviewBase => ({
  name: "",
  interviewer_id: 0,
  objective: "",
  question_count: 0,
  time_duration: String(defaultDuration),
  is_anonymous: false,
  questions: [],
  description: "",
  response_count: 0,
});

function CreateInterviewModal({ open, setOpen, interviewers, defaultDuration }: Props) {
  const [loading, setLoading] = useState(false);
  const [proceed, setProceed] = useState(false);
  const [interviewData, setInterviewData] = useState<InterviewBase>(
    CreateEmptyInterviewData(defaultDuration),
  );

  // Below for File Upload
  const [isUploaded, setIsUploaded] = useState(false);
  const [fileName, setFileName] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: Need to check
  useEffect(() => {
    if (loading === true) {
      setLoading(false);
      setProceed(true);
    }
  }, [interviewData, loading]);

  useEffect(() => {
    if (!open) {
      setLoading(false);
      setProceed(false);
      setInterviewData(CreateEmptyInterviewData(defaultDuration));
      // Below for File Upload
      setIsUploaded(false);
      setFileName("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {loading ? (
        <div className="w-full max-w-[38rem] h-[35.3rem]">
          <LoaderWithLogo />
        </div>
      ) : !proceed ? (
        <DetailsPopup
          open={open}
          setLoading={setLoading}
          interviewData={interviewData}
          setInterviewData={setInterviewData}
          // Below for File Upload
          isUploaded={isUploaded}
          setIsUploaded={setIsUploaded}
          fileName={fileName}
          setFileName={setFileName}
          interviewers={interviewers}
        />
      ) : (
        <QuestionsPopup interviewData={interviewData} setProceed={setProceed} setOpen={setOpen} />
      )}
    </>
  );
}

export default CreateInterviewModal;
