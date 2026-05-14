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
      "페이스북 광고 정책 위반 시 대처 방법",
      "금지된 광고 콘텐츠는 무엇인가요?",
      "광고 승인 거부 사유 확인 방법",
      "연령 제한 광고 설정 방법",
      "개인정보 보호 정책 준수 가이드"
    ]
  },
  {
    id: "targeting",
    title: "타겟팅 검토",
    icon: <Target className="w-4 h-4" />,
    color: "border-[#C6D9CB] bg-[#EDF7EF] text-[#1F7A4D]",
    questions: [
      "페이스북 광고 타겟팅 옵션 설정",
      "관심사 기반 타겟팅 활용법",
      "리타겟팅 광고 설정 방법",
      "룩얼라이크 오디언스 생성",
      "지역별 타겟팅 최적화"
    ]
  },
  {
    id: "budget",
    title: "예산·입찰 판단",
    icon: <DollarSign className="w-4 h-4" />,
    color: "border-[#E9D59B] bg-[#FFF8E6] text-[#8A6418]",
    questions: [
      "광고 예산 설정 및 관리 방법",
      "입찰 전략 선택 가이드",
      "CPC vs CPM 차이점과 선택 기준",
      "일일 예산 vs 총 예산 설정",
      "입찰 가격 최적화 방법"
    ]
  },
  {
    id: "analytics",
    title: "성과 기준 확인",
    icon: <BarChart3 className="w-4 h-4" />,
    color: "border-[#D6D8CD] bg-[#FBFBF7] text-[#5F6C62]",
    questions: [
      "광고 성과 지표 해석 방법",
      "ROAS 계산 및 분석",
      "A/B 테스트 설계 및 실행",
      "광고 보고서 분석 가이드",
      "성과 개선을 위한 최적화 팁"
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
        <CardTitle className="flex items-center space-x-2 text-sm font-semibold text-[#111713]">
          <Sparkles className="h-4 w-4 text-[#1F7A4D]" />
          <span>{currentQuestion ? '후속 검토 질문' : '정책 검토 시작점'}</span>
          <Badge variant="outline" className="rounded-md border-[#C6D9CB] bg-[#EDF7EF] px-2 py-0.5 text-[11px] text-[#1F7A4D]">
            {currentQuestion ? vectorBasedQuestions.length : questionCategories.reduce((total, cat) => total + cat.questions.length, 0)}개
          </Badge>
        </CardTitle>
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
                <p className="text-sm text-[#5F6C62]">후속 검토 질문을 찾을 수 없습니다</p>
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
