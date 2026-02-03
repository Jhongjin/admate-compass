"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface FeedbackProps {
  onFeedback: (helpful: boolean, comment?: string) => void;
  onClose: () => void;
}

export default function Feedback({ onFeedback, onClose }: FeedbackProps) {
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);

  const handleFeedback = (isHelpful: boolean) => {
    setHelpful(isHelpful);
    if (isHelpful) {
      onFeedback(isHelpful);
      onClose();
    } else {
      setShowComment(true);
    }
  };

  const handleSubmit = () => {
    onFeedback(helpful!, comment);
    onClose();
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="text-lg text-center">답변이 도움이 되었나요?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-center space-x-4">
          <Button
            variant={helpful === true ? "default" : "outline"}
            size="lg"
            onClick={() => handleFeedback(true)}
            className="flex items-center space-x-2 px-6"
          >
            <ThumbsUp className="w-5 h-5" />
            <span>도움됨</span>
          </Button>
          
          <Button
            variant={helpful === false ? "default" : "outline"}
            size="lg"
            onClick={() => handleFeedback(false)}
            className="flex items-center space-x-2 px-6"
          >
            <ThumbsDown className="w-5 h-5" />
            <span>도움 안됨</span>
          </Button>
        </div>

        {showComment && (
          <div className="space-y-3">
            <div className="text-sm text-gray-600 text-center">
              <MessageSquare className="w-4 h-4 inline mr-1" />
              개선점을 알려주세요
            </div>
            <Textarea
              placeholder="답변이 부족했던 부분이나 개선하고 싶은 점을 자유롭게 작성해주세요..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="min-h-[100px] resize-none"
            />
            <div className="flex space-x-2">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1"
              >
                취소
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!comment.trim()}
                className="flex-1"
              >
                제출
              </Button>
            </div>
          </div>
        )}

        {helpful === null && (
          <div className="text-center">
            <Button
              variant="ghost"
              onClick={onClose}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              나중에 하기
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
