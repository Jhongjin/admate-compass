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
    title: "광고 정책 관련",
    icon: <FileText className="w-4 h-4" />,
    color: "bg-blue-500",
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
    title: "타겟팅 관련",
    icon: <Target className="w-4 h-4" />,
    color: "bg-green-500",
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
    title: "예산 및 입찰 관련",
    icon: <DollarSign className="w-4 h-4" />,
    color: "bg-purple-500",
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
    title: "성과 분석 관련",
    icon: <BarChart3 className="w-4 h-4" />,
    color: "bg-orange-500",
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

  // 관련 질문이 없으면 카드를 렌더링하지 않음
  if (currentQuestion && !isLoadingVectorQuestions && vectorBasedQuestions.length === 0) {
    return null;
  }

  return (
    <Card className="w-full bg-gradient-to-br from-white/95 to-[#FAF8F3]/95 backdrop-blur-sm border-orange-200/30 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center space-x-2 text-gray-800 text-lg font-semibold">
          <Sparkles className="w-5 h-5 text-orange-500" />
          <span>{currentQuestion ? '관련 질문' : '빠른 질문'}</span>
          <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700 border-orange-200">
            {currentQuestion ? vectorBasedQuestions.length : questionCategories.reduce((total, cat) => total + cat.questions.length, 0)}개
          </Badge>
        </CardTitle>
        <Separator className="bg-orange-200/50" />
      </CardHeader>
      <CardContent className="space-y-3">
        {currentQuestion ? (
          // 벡터 검색 기반 관련 질문 리스트
          <div className="space-y-2">
            {isLoadingVectorQuestions ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-gradient-to-br from-orange-200 to-pink-200 rounded-full flex items-center justify-center mx-auto mb-3">
                  <div className="w-6 h-6 border-2 border-orange-300 border-t-orange-600 rounded-full animate-spin"></div>
                </div>
                <p className="text-xs text-gray-600">관련 질문을 찾는 중...</p>
              </div>
            ) : vectorBasedQuestions.length > 0 ? (
              vectorBasedQuestions.map((question, index) => (
                <Button
                  key={index}
                  variant="outline"
                  size="sm"
                  onClick={() => onQuestionClick(question)}
                  className="w-full justify-start text-left h-auto p-3 text-sm text-gray-700 hover:text-gray-800 hover:bg-orange-50 hover:border-orange-200 transition-all duration-200 border-gray-200"
                >
                  <div className="flex items-start space-x-3">
                    <div className="w-2 h-2 bg-orange-500 rounded-full mt-2 flex-shrink-0"></div>
                    <span className="line-clamp-2 text-left">{question}</span>
                  </div>
                </Button>
              ))
            ) : null}
          </div>
        ) : (
          // 기본 카테고리별 질문 리스트
          questionCategories.map((category) => (
            <div key={category.id} className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleCategory(category.id)}
                className="w-full justify-between h-auto p-3 text-left hover:bg-orange-50 hover:border-orange-200 transition-all duration-200 border-gray-200"
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 ${category.color} rounded-full flex items-center justify-center`}>
                    {category.icon}
                  </div>
                  <div className="flex-1 text-left">
                    <h4 className="text-base font-semibold text-gray-800">{category.title}</h4>
                    <p className="text-xs text-gray-600">{category.questions.length}개 질문</p>
                  </div>
                </div>
                {expandedCategories.has(category.id) ? (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-500" />
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
                      className="w-full justify-start text-left h-auto p-2 text-sm text-gray-700 hover:text-gray-800 hover:bg-orange-50 hover:border-orange-200 transition-all duration-200 border-gray-200"
                    >
                      <div className="flex items-start space-x-2">
                        <div className="w-1.5 h-1.5 bg-orange-400 rounded-full mt-2 flex-shrink-0"></div>
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
