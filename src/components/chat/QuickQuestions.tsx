"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Target, 
  DollarSign, 
  BarChart3, 
  FileText, 
  ChevronDown, 
  ChevronRight,
  Sparkles,
  Lightbulb
} from "lucide-react";

interface QuickQuestionsProps {
  onQuestionClick: (question: string) => void;
  currentQuestion?: string;
}

interface QuestionCategory {
  id: string;
  title: string;
  icon: React.ReactNode;
  color: string;
  questions: string[];
}

const questionCategories: QuestionCategory[] = [
  {
    id: "policy",
    title: "정책 리스크 확인",
    icon: <FileText className="w-4 h-4" />,
    color: "border-[#B9D8E2] bg-[#EAF4F7] text-[#1F6F8B]",
    questions: [
      "Meta 금융 광고 소재에서 필수 고지 문구와 제한 표현을 확인해줘",
      "건강기능식품 광고에서 심사 리스크가 높은 표현을 출처와 함께 정리해줘",
      "정치·사회 이슈 광고 집행 전 확인해야 할 정책 근거를 찾아줘",
      "연령 제한이 필요한 업종의 타겟팅 정책 근거를 확인해줘",
      "개인정보 수집 랜딩 페이지 광고의 정책 검토 포인트를 알려줘"
    ]
  },
  {
    id: "targeting",
    title: "타겟팅 검토",
    icon: <Target className="w-4 h-4" />,
    color: "border-[#C6D9CB] bg-[#EDF7EF] text-[#1F7A4D]",
    questions: [
      "민감 카테고리에서 사용할 수 없는 타겟팅 조건을 확인해줘",
      "리타겟팅 광고 운영 전에 확인해야 할 개인정보 정책 근거를 찾아줘",
      "룩얼라이크 오디언스 사용 시 제한되는 업종이나 표현이 있는지 검토해줘",
      "지역 타겟팅 광고에서 고지나 차별 리스크가 있는지 확인해줘",
      "미성년자 대상 광고 타겟팅 정책을 출처 기준으로 정리해줘"
    ]
  },
  {
    id: "budget",
    title: "예산·입찰 판단",
    icon: <DollarSign className="w-4 h-4" />,
    color: "border-[#E9D59B] bg-[#FFF8E6] text-[#8A6418]",
    questions: [
      "금융 업종 캠페인 예산 증액 전 정책상 추가 확인이 필요한 항목을 알려줘",
      "전환 최적화 캠페인에서 랜딩 페이지 정책 리스크를 검토해줘",
      "앱 설치 캠페인 집행 전 심사 거절 가능성이 있는 소재 요소를 찾아줘",
      "프로모션 문구가 포함된 캠페인의 가격 표시 정책 근거를 확인해줘",
      "성과형 캠페인에서 과장 표현으로 볼 수 있는 문구 기준을 정리해줘"
    ]
  },
  {
    id: "analytics",
    title: "성과 기준 확인",
    icon: <BarChart3 className="w-4 h-4" />,
    color: "border-[#D6D8CD] bg-[#FBFBF7] text-[#5F6C62]",
    questions: [
      "심사 거절이 반복되는 소재의 정책 원인 후보를 정리해줘",
      "광고주 문의 답변에 사용할 수 있는 공식 정책 근거를 찾아줘",
      "캠페인 운영 중단 판단 전에 확인할 정책 체크리스트를 만들어줘",
      "소재 수정안이 기존 거절 사유를 해소하는지 검토해줘",
      "보고서에 남길 정책 검토 근거와 출처 요약을 작성해줘"
    ]
  }
];

export default function QuickQuestions({ onQuestionClick, currentQuestion }: QuickQuestionsProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [vectorBasedQuestions, setVectorBasedQuestions] = useState<string[]>([]);
  const [isLoadingVectorQuestions, setIsLoadingVectorQuestions] = useState(false);

  // 벡터 검색 기반 관련 질문 가져오기
  const fetchVectorBasedQuestions = async (question: string) => {
    if (!question.trim()) return;
    
    setIsLoadingVectorQuestions(true);
    try {
      const response = await fetch('/api/related-questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: question }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setVectorBasedQuestions(data.relatedQuestions || []);
      }
    } catch (error) {
      console.error('벡터 기반 관련 질문 가져오기 실패:', error);
    } finally {
      setIsLoadingVectorQuestions(false);
    }
  };

  // 사용자 질문이 변경될 때마다 벡터 기반 관련 질문 가져오기
  useEffect(() => {
    if (currentQuestion) {
      fetchVectorBasedQuestions(currentQuestion);
    }
  }, [currentQuestion]);

  // 현재 질문과 유사한 질문들을 찾는 함수
  const getSimilarQuestions = (currentQ?: string) => {
    if (!currentQ) return [];
    
    const allQuestions = questionCategories.flatMap(cat => cat.questions);
    const currentKeywords = currentQ.toLowerCase()
      .split(/[\s,.\-!?]+/)
      .filter(word => word.length > 2)
      .map(word => word.replace(/[^\u3131-\u3163\uac00-\ud7a3a-zA-Z0-9]/g, ''));
    
    // 키워드 매칭 점수 계산
    const scoredQuestions = allQuestions
      .filter(q => q !== currentQ)
      .map(q => {
        const questionLower = q.toLowerCase();
        let similarity = 0;
        
        // 정확한 키워드 매칭
        currentKeywords.forEach(keyword => {
          if (questionLower.includes(keyword)) {
            similarity += 2; // 정확한 매칭은 높은 점수
          }
        });
        
        // 부분 매칭 (한글의 경우)
        currentKeywords.forEach(keyword => {
          if (keyword.length > 3) {
            const partialMatches = questionLower.match(new RegExp(keyword.substring(0, 3), 'g'));
            if (partialMatches) {
              similarity += partialMatches.length * 0.5;
            }
          }
        });
        
        // 관련 키워드 매칭
        const relatedKeywords = {
          '광고': ['ad', 'advertising', 'campaign', '캠페인'],
          '정책': ['policy', 'policies', 'rule', '규칙'],
          '타겟팅': ['targeting', 'audience', '오디언스'],
          '예산': ['budget', 'bid', '입찰'],
          '승인': ['approval', 'review', '검토'],
          '페이스북': ['facebook', 'fb', 'meta'],
          '인스타그램': ['instagram', 'ig']
        };
        
        Object.entries(relatedKeywords).forEach(([korean, english]) => {
          if (currentKeywords.some(k => k.includes(korean) || korean.includes(k))) {
            english.forEach(eng => {
              if (questionLower.includes(eng)) {
                similarity += 1;
              }
            });
          }
        });
        
        return { question: q, similarity };
      })
      .filter(item => item.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 6); // 상위 6개만 표시
    
    return scoredQuestions.map(item => item.question);
  };

  const similarQuestions = getSimilarQuestions(currentQuestion);

  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  return (
    <Card className="w-full rounded-lg border-[#D6D8CD] bg-white shadow-sm">
      <CardHeader className="pb-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#758070]">
          검토 질문
        </div>
        <CardTitle className="flex items-center space-x-2 text-sm font-semibold text-[#111713]">
          <Sparkles className="h-4 w-4 text-[#1F7A4D]" />
          <span>{currentQuestion ? '후속 검토 질문' : '정책 검토 시작점'}</span>
          <Badge variant="outline" className="rounded-md border-[#C6D9CB] bg-[#EDF7EF] px-2 py-0.5 text-[11px] text-[#1F7A4D]">
            {currentQuestion ? vectorBasedQuestions.length : questionCategories.reduce((total, cat) => total + cat.questions.length, 0)}개
          </Badge>
        </CardTitle>
        <p className="mt-2 text-xs leading-5 text-[#5F6C62]">
          정책 항목, 업종, 소재 표현을 함께 넣어 인용 가능한 근거 중심으로 질문을 좁힙니다.
        </p>
        <Separator className="bg-[#D8DCCF]" />
      </CardHeader>
      <CardContent className="space-y-3">
        {currentQuestion ? (
          // 벡터 검색 기반 관련 질문 리스트
          <div className="space-y-2">
            {isLoadingVectorQuestions ? (
              <div className="text-center py-8">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF]">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#C6D9CB] border-t-[#1F7A4D]"></div>
                </div>
                <p className="text-sm text-[#5F6C62]">후속 검토 질문을 찾는 중...</p>
              </div>
            ) : vectorBasedQuestions.length > 0 ? (
              vectorBasedQuestions.map((question, index) => (
                <Button
                  key={index}
                  variant="outline"
                  size="sm"
                  onClick={() => onQuestionClick(question)}
                  className="h-auto w-full justify-start border-[#D8DCCF] p-3 text-left text-xs text-[#34423A] transition-colors hover:border-[#B9C9BB] hover:bg-[#FBFBF7] hover:text-[#111713]"
                >
                  <div className="flex items-start space-x-3">
                    <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-[#1F7A4D]"></div>
                    <span className="line-clamp-2 text-left">{question}</span>
                  </div>
                </Button>
              ))
            ) : (
              <div className="text-center py-8">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-[#E9D59B] bg-[#FFF8E6]">
                  <Lightbulb className="h-6 w-6 text-[#8A6418]" />
                </div>
                <p className="text-sm text-[#5F6C62]">후속 검토 질문을 찾을 수 없습니다. 플랫폼과 소재 표현을 더 구체화해 주세요.</p>
              </div>
            )}
          </div>
        ) : (
          // 기본 카테고리별 질문 리스트
          questionCategories.map((category) => (
            <div key={category.id} className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleCategory(category.id)}
                className="h-auto w-full justify-between border-[#D8DCCF] p-3 text-left transition-colors hover:border-[#B9C9BB] hover:bg-[#FBFBF7]"
              >
                <div className="flex items-center space-x-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${category.color}`}>
                    {category.icon}
                  </div>
                  <div className="flex-1 text-left">
                    <h4 className="text-sm font-medium text-[#111713]">{category.title}</h4>
                    <p className="text-xs text-[#5F6C62]">{category.questions.length}개 질문</p>
                  </div>
                </div>
                {expandedCategories.has(category.id) ? (
                  <ChevronDown className="h-4 w-4 text-[#5F6C62]" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-[#5F6C62]" />
                )}
              </Button>
              
              {expandedCategories.has(category.id) && (
                <div className="ml-4 space-y-1">
                  {category.questions.map((question, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      size="sm"
                      onClick={() => onQuestionClick(question)}
                      className="h-auto w-full justify-start border-[#D8DCCF] p-2 text-left text-xs text-[#34423A] transition-colors hover:border-[#B9C9BB] hover:bg-[#FBFBF7] hover:text-[#111713]"
                    >
                      <div className="flex items-start space-x-2">
                        <div className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#1F7A4D]"></div>
                        <span className="line-clamp-2 text-left">{question}</span>
                      </div>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
