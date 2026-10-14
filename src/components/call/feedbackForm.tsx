import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { FeedbackData } from "@/types/response";
import React, { useState } from "react";

enum SatisfactionLevel {
  Positive = "😀",
  Moderate = "😐",
  Negative = "😔",
}

interface FeedbackFormProps {
  onSubmit: (data: Omit<FeedbackData, "interview_id">) => void;
  email: string;
}

export function FeedbackForm({ onSubmit, email }: FeedbackFormProps) {
  const [satisfaction, setSatisfaction] = useState<SatisfactionLevel>(SatisfactionLevel.Moderate);
  const [feedback, setFeedback] = useState("");

  const handleSubmit = () => {
    if (satisfaction !== null || feedback.trim() !== "") {
      onSubmit({
        satisfaction: Object.values(SatisfactionLevel).indexOf(satisfaction),
        feedback,
        email,
      });
    }
  };

  return (
    <div className="p-5 sm:p-6">
      <p className="mb-4 text-sm leading-6 text-slate-600">
        请选择你的整体感受，也可以补充具体建议。
      </p>
      <div className="mb-5 flex justify-center gap-4">
        {Object.values(SatisfactionLevel).map((emoji) => (
          <button
            type="button"
            key={emoji}
            aria-label={
              emoji === SatisfactionLevel.Positive
                ? "满意"
                : emoji === SatisfactionLevel.Moderate
                  ? "一般"
                  : "不满意"
            }
            className={`rounded-xl p-2 text-3xl transition ${satisfaction === emoji ? "border-2 border-indigo-600 bg-indigo-50" : "border-2 border-transparent hover:bg-slate-100"}`}
            onClick={() => setSatisfaction(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
      <Textarea
        value={feedback}
        placeholder="请填写你的反馈（可选）"
        aria-label="面试反馈"
        className="mb-4 min-h-28 resize-y"
        onChange={(e) => setFeedback(e.target.value)}
      />
      <Button
        disabled={satisfaction === null && feedback.trim() === ""}
        className="w-full bg-indigo-600 text-white"
        onClick={handleSubmit}
      >
        提交反馈
      </Button>
    </div>
  );
}
