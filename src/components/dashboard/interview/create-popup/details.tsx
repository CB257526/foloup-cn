import Modal from "@/components/dashboard/Modal";
import InterviewerDetailsModal from "@/components/dashboard/interviewer/interviewerDetailsModal";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { InterviewBase, Question } from "@/types/interview";
import type { Interviewer } from "@/types/interviewer";
import axios from "axios";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import Image from "next/image";
import React, { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import FileUpload from "../fileUpload";
import {
  DEFAULT_INTERVIEW_DURATION_MINUTES,
  MAX_INTERVIEW_DURATION_MINUTES,
} from "@/lib/constants";

interface Props {
  open: boolean;
  setLoading: (loading: boolean) => void;
  interviewData: InterviewBase;
  setInterviewData: (interviewData: InterviewBase) => void;
  isUploaded: boolean;
  setIsUploaded: (isUploaded: boolean) => void;
  fileName: string;
  setFileName: (fileName: string) => void;
  interviewers: Interviewer[];
}

function DetailsPopup({
  open,
  setLoading,
  interviewData,
  setInterviewData,
  isUploaded,
  setIsUploaded,
  fileName,
  setFileName,
  interviewers,
}: Props) {
  const [isClicked, setIsClicked] = useState(false);
  const [openInterviewerDetails, setOpenInterviewerDetails] = useState(false);
  const [interviewerDetails, setInterviewerDetails] = useState<Interviewer>();

  const [name, setName] = useState(interviewData.name);
  const [selectedInterviewer, setSelectedInterviewer] = useState(interviewData.interviewer_id);
  const [objective, setObjective] = useState(interviewData.objective);
  const [isAnonymous, setIsAnonymous] = useState<boolean>(interviewData.is_anonymous);
  const [numQuestions, setNumQuestions] = useState(
    interviewData.question_count === 0 ? "" : String(interviewData.question_count),
  );
  const [duration, setDuration] = useState(
    interviewData.time_duration || String(DEFAULT_INTERVIEW_DURATION_MINUTES),
  );
  const [uploadedDocumentContext, setUploadedDocumentContext] = useState("");

  const slideLeft = (id: string, value: number) => {
    const slider = document.getElementById(`${id}`);
    if (slider) {
      slider.scrollLeft = slider.scrollLeft - value;
    }
  };

  const slideRight = (id: string, value: number) => {
    const slider = document.getElementById(`${id}`);
    if (slider) {
      slider.scrollLeft = slider.scrollLeft + value;
    }
  };

  const onGenrateQuestions = async () => {
    setLoading(true);

    const data = {
      name: name.trim(),
      objective: objective.trim(),
      number: numQuestions,
      context: uploadedDocumentContext,
    };

    const generatedQuestions = (await axios.post("/api/generate-interview-questions", data)) as any;

    const generatedQuestionsResponse = JSON.parse(generatedQuestions?.data?.response);

    const updatedQuestions = generatedQuestionsResponse.questions.map((question: Question) => ({
      id: uuidv4(),
      question: question.question.trim(),
      follow_up_count: 1,
    }));

    const updatedInterviewData = {
      ...interviewData,
      name: name.trim(),
      objective: objective.trim(),
      questions: updatedQuestions,
      interviewer_id: selectedInterviewer,
      question_count: Number(numQuestions),
      time_duration: duration,
      description: generatedQuestionsResponse.description,
      is_anonymous: isAnonymous,
    };
    setInterviewData(updatedInterviewData);
  };

  const onManual = () => {
    setLoading(true);

    const updatedInterviewData = {
      ...interviewData,
      name: name.trim(),
      objective: objective.trim(),
      questions: [{ id: uuidv4(), question: "", follow_up_count: 1 }],
      interviewer_id: selectedInterviewer,
      question_count: Number(numQuestions),
      time_duration: String(duration),
      description: "",
      is_anonymous: isAnonymous,
    };
    setInterviewData(updatedInterviewData);
  };

  useEffect(() => {
    if (!open) {
      setName("");
      setSelectedInterviewer(0);
      setObjective("");
      setIsAnonymous(false);
      setNumQuestions("");
      setDuration("");
      setIsClicked(false);
    }
  }, [open]);

  return (
    <>
      <div className="w-full max-w-[38rem] max-h-[90vh] overflow-y-auto px-2 text-center">
        <h1 className="text-xl font-semibold">创建岗位</h1>
        <div className="flex flex-col justify-center items-start mt-4 ml-10 mr-8">
          <div className="flex flex-row justify-center items-center">
            <h3 className="text-sm font-medium">岗位名称：</h3>
            <input
              type="text"
              className="border-b-2 focus:outline-none border-gray-500 px-2 w-96 py-0.5 ml-3"
              placeholder="例如：前端开发工程师面试"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={(e) => setName(e.target.value.trim())}
            />
          </div>
          <h3 className="text-sm mt-3 font-medium">选择面试官：</h3>
          <div className="relative flex items-center mt-1">
            <div
              id="slider-3"
              className="h-36 w-full max-w-[27.5rem] overflow-x-auto pt-1 whitespace-nowrap scroll-smooth scrollbar-hide"
            >
              {interviewers.map((item, key) => (
                <div
                  className=" p-0 inline-block cursor-pointer ml-1 mr-5 rounded-xl shrink-0 overflow-hidden"
                  key={item.id}
                >
                  <button
                    type="button"
                    className="absolute ml-9"
                    onClick={(e) => {
                      e.stopPropagation();
                      setInterviewerDetails(item);
                      setOpenInterviewerDetails(true);
                    }}
                  >
                    <Info size={18} color="#4f46e5" strokeWidth={2.2} />
                  </button>
                  <button
                    type="button"
                    className={`w-[96px] overflow-hidden rounded-full ${
                      selectedInterviewer === item.id ? "border-4 border-indigo-600" : ""
                    }`}
                    onClick={() => setSelectedInterviewer(item.id)}
                  >
                    <Image
                      src={item.image || "/user-icon.png"}
                      alt="面试官照片"
                      width={70}
                      height={70}
                      className="w-full h-full object-cover"
                      onError={(event) => {
                        // 自定义面试官的旧头像失效时仍允许 HR 完成岗位创建。
                        event.currentTarget.src = "/user-icon.png";
                      }}
                    />
                  </button>
                  <CardTitle className="mt-0 text-xs text-center">{item.name}</CardTitle>
                </div>
              ))}
            </div>
            {interviewers.length > 4 ? (
              <div className="flex-row justify-center ml-3 mb-1 items-center space-y-6">
                <ChevronRight
                  className="opacity-50 cursor-pointer hover:opacity-100"
                  size={27}
                  onClick={() => slideRight("slider-3", 115)}
                />
                <ChevronLeft
                  className="opacity-50 cursor-pointer hover:opacity-100"
                  size={27}
                  onClick={() => slideLeft("slider-3", 115)}
                />
              </div>
            ) : (
              <></>
            )}
          </div>
          <h3 className="text-sm font-medium">面试目标：</h3>
          <Textarea
            value={objective}
            className="h-24 mt-2 w-full border-2 border-gray-500"
            placeholder="例如：根据候选人的技术能力与过往项目评估其匹配度。"
            onChange={(e) => setObjective(e.target.value)}
            onBlur={(e) => setObjective(e.target.value.trim())}
          />
          <h3 className="text-sm font-medium mt-2">上传与本次面试相关的文档。</h3>
          <FileUpload
            isUploaded={isUploaded}
            setIsUploaded={setIsUploaded}
            fileName={fileName}
            setFileName={setFileName}
            setUploadedDocumentContext={setUploadedDocumentContext}
          />
          <div className="flex-col mt-7 w-full">
            <div className="flex items-center cursor-pointer">
              <span className="text-sm font-medium">是否希望候选人的面试记录匿名？</span>
              <Switch
                checked={isAnonymous}
                className={`ml-4 mt-1 ${isAnonymous ? "bg-indigo-600" : "bg-[#E6E7EB]"}`}
                onCheckedChange={(checked) => setIsAnonymous(checked)}
              />
            </div>
            <span
              style={{ fontSize: "0.7rem", lineHeight: "0.66rem" }}
              className="font-light text-xs italic w-full text-left block"
            >
              注意：若非匿名，将收集候选人的邮箱和姓名。
            </span>
          </div>
          <div className="flex flex-row gap-3 justify-between w-full mt-3">
            <div className="flex flex-row justify-center items-center ">
              <h3 className="text-sm font-medium ">题目数量：</h3>
              <input
                type="number"
                step="1"
                max="5"
                min="1"
                className="border-b-2 text-center focus:outline-none  border-gray-500 w-14 px-2 py-0.5 ml-3"
                value={numQuestions}
                onChange={(e) => {
                  let value = e.target.value;
                  if (value === "" || (Number.isInteger(Number(value)) && Number(value) > 0)) {
                    if (Number(value) > 5) {
                      value = "5";
                    }
                    setNumQuestions(value);
                  }
                }}
              />
            </div>
            <div className="flex flex-row justify-center items-center">
              <h3 className="text-sm font-medium ">时长（分钟）：</h3>
              <input
                type="number"
                step="1"
                max={String(MAX_INTERVIEW_DURATION_MINUTES)}
                min="1"
                className="border-b-2 text-center focus:outline-none  border-gray-500 w-14 px-2 py-0.5 ml-3"
                value={duration}
                onChange={(e) => {
                  let value = e.target.value;
                  if (value === "" || (Number.isInteger(Number(value)) && Number(value) > 0)) {
                    if (Number(value) > MAX_INTERVIEW_DURATION_MINUTES) {
                      value = String(MAX_INTERVIEW_DURATION_MINUTES);
                    }
                    setDuration(value);
                  }
                }}
              />
            </div>
          </div>
          <div className="flex flex-row w-full justify-center items-center space-x-24 mt-5">
            <Button
              disabled={
                !(
                  name &&
                  objective &&
                  numQuestions &&
                  Number(duration) >= 1 &&
                  selectedInterviewer !== 0
                ) || isClicked
              }
              className="bg-indigo-600 hover:bg-indigo-800  w-40"
              onClick={() => {
                setIsClicked(true);
                onGenrateQuestions();
              }}
            >
              生成题目
            </Button>
            <Button
              disabled={
                !(name && objective && numQuestions && duration && selectedInterviewer !== 0) ||
                isClicked
              }
              className="bg-indigo-600 w-40 hover:bg-indigo-800"
              onClick={() => {
                setIsClicked(true);
                onManual();
              }}
            >
              我来手动填写
            </Button>
          </div>
        </div>
      </div>
      <Modal
        open={openInterviewerDetails}
        closeOnOutsideClick={true}
        onClose={() => {
          setOpenInterviewerDetails(false);
        }}
      >
        <InterviewerDetailsModal interviewer={interviewerDetails} />
      </Modal>
    </>
  );
}

export default DetailsPopup;
