import { createInterviewAction } from "@/app/actions/interviews";
import QuestionCard from "@/components/dashboard/interview/create-popup/questionCard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { InterviewBase, Question } from "@/types/interview";
import { Plus } from "lucide-react";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

interface Props {
  interviewData: InterviewBase;
  setProceed: (proceed: boolean) => void;
  setOpen: (open: boolean) => void;
}

function QuestionsPopup({ interviewData, setProceed, setOpen }: Props) {
  const [isClicked, setIsClicked] = useState(false);

  const [questions, setQuestions] = useState<Question[]>(interviewData.questions);
  const [description, setDescription] = useState<string>(interviewData.description.trim());
  const router = useRouter();

  const endOfListRef = useRef<HTMLDivElement>(null);
  const prevQuestionLengthRef = useRef(questions.length);

  const handleInputChange = (id: string, newQuestion: Question) => {
    setQuestions(
      questions.map((question) =>
        question.id === id ? { ...question, ...newQuestion } : question,
      ),
    );
  };

  const handleDeleteQuestion = (id: string) => {
    if (questions.length === 1) {
      setQuestions(
        questions.map((question) => ({
          ...question,
          question: "",
          follow_up_count: 1,
        })),
      );

      return;
    }
    setQuestions(questions.filter((question) => question.id !== id));
  };

  const handleAddQuestion = () => {
    if (questions.length < interviewData.question_count) {
      setQuestions([...questions, { id: uuidv4(), question: "", follow_up_count: 1 }]);
    }
  };

  const onSave = async () => {
    try {
      interviewData.questions = questions;
      interviewData.description = description;

      const payload = {
        ...interviewData,
        interviewer_id: interviewData.interviewer_id ?? null,
        response_count: 0,
        question_count: questions.length,
        time_duration: String(interviewData.time_duration),
        // 单租户：logo 不再来自 Clerk 组织头像
        logo_url: "",
      };

      await createInterviewAction(payload);
      setIsClicked(false);
      setOpen(false);
      router.refresh();
    } catch (error) {
      console.error("Error creating interview:", error);
      setIsClicked(false);
    }
  };

  useEffect(() => {
    if (questions.length > prevQuestionLengthRef.current) {
      endOfListRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevQuestionLengthRef.current = questions.length;
  }, [questions.length]);

  return (
    <div>
      <div
        className={`text-center px-1 flex flex-col justify-top items-center w-[38rem] ${
          interviewData.question_count > 1 ? "h-[29rem]" : ""
        } `}
      >
        <div className="relative flex justify-center w-full">
          <ChevronLeft
            className="absolute left-0 opacity-50 cursor-pointer hover:opacity-100 text-gray-600 mr-36"
            size={30}
            onClick={() => {
              setProceed(false);
            }}
          />
          <h1 className="text-2xl font-semibold">创建岗位</h1>
        </div>
        <div className="my-3 text-left w-[96%] text-sm">
          面试将使用以下题目，请确认无误。
        </div>
        <ScrollArea className="flex flex-col justify-center items-center w-full mt-3">
          {questions.map((question, index) => (
            <QuestionCard
              key={question.id}
              questionNumber={index + 1}
              questionData={question}
              onDelete={handleDeleteQuestion}
              onQuestionChange={handleInputChange}
            />
          ))}
          <div ref={endOfListRef} />
        </ScrollArea>
        {questions.length < interviewData.question_count ? (
          <button
            type="button"
            className="border-indigo-600 opacity-75 hover:opacity-100 w-fit rounded-full"
            onClick={handleAddQuestion}
          >
            <Plus size={45} strokeWidth={2.2} className="text-indigo-600 cursor-pointer" />
          </button>
        ) : (
          <></>
        )}
      </div>
      <p className="mt-3 mb-1 ml-2 font-medium">
        岗位描述{" "}
        <span
          style={{ fontSize: "0.7rem", lineHeight: "0.66rem" }}
          className="font-light text-xs italic w-full text-left block"
        >
          说明：候选人将看到这段描述。
        </span>
      </p>
      <textarea
        value={description}
        className="h-fit mt-3 mx-2 py-2 border-2 rounded-md px-2 w-full border-gray-400"
        placeholder="请输入岗位描述。"
        rows={3}
        onChange={(e) => {
          setDescription(e.target.value);
        }}
        onBlur={(e) => {
          setDescription(e.target.value.trim());
        }}
      />
      <div className="flex flex-row justify-end items-end w-full">
        <Button
          disabled={
            isClicked ||
            questions.length < interviewData.question_count ||
            description.trim() === "" ||
            questions.some((question) => question.question.trim() === "")
          }
          className="bg-indigo-600 hover:bg-indigo-800 mr-5 mt-2"
          onClick={() => {
            setIsClicked(true);
            onSave();
          }}
        >
          保存
        </Button>
      </div>
    </div>
  );
}
export default QuestionsPopup;
