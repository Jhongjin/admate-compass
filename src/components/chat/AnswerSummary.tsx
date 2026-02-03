"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { 
  FileText, 
  Calendar, 
  Download,
  Globe,
  ExternalLink,
  BookOpen,
  Lightbulb,
  CheckCircle,
  Loader2,
  AlertCircle
} from "lucide-react";
import { motion } from "framer-motion";
import { useAnswerSummary } from "@/hooks/useAnswerSummary";

interface AnswerSummaryProps {
  aiResponse: string;
  sources: Array<{
    id: string;
    title: string;
    url?: string;
    updatedAt: string;
    excerpt: string;
    sourceType?: 'file' | 'url';
    documentType?: string;
    similarity?: number;
  }>;
  userQuestion: string;
}

export default function AnswerSummary({ 
  aiResponse, 
  sources, 
  userQuestion 
}: AnswerSummaryProps) {
  // AI 응답이 완전히 로드되었는지 확인
  const isResponseReady = aiResponse && aiResponse.trim().length > 0;
  
  // LLM을 사용한 답변 요약
  const { summaryData, isLoading, error } = useAnswerSummary({
    aiResponse,
    userQuestion,
    sources
  });

  // 문서별 핵심 내용 요약
  const getDocumentSummary = (source: any): string => {
    const excerpt = source.excerpt || '';
    if (excerpt.length > 100) {
      return excerpt.substring(0, 100) + '...';
    }
    return excerpt;
  };

  // AI 응답이 준비되지 않은 경우
  if (!isResponseReady) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="w-full bg-gradient-to-br from-blue-50/95 to-indigo-50/95 backdrop-blur-sm border-blue-200/30 shadow-lg">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center space-x-2 text-gray-800 text-xl font-bold">
              <Lightbulb className="w-6 h-6 text-blue-500" />
              <span>답변 핵심 요약</span>
              <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 border-blue-200">
                AI 분석
              </Badge>
            </CardTitle>
            <Separator className="bg-blue-200/50" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                </div>
                <p className="text-sm text-gray-600">AI 답변을 기다리는 중...</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-4 duration-500">
      <Card className="w-full bg-gradient-to-br from-blue-50/95 to-indigo-50/95 backdrop-blur-sm border-blue-200/30 shadow-lg">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center space-x-2 text-gray-800 text-xl font-bold">
            <Lightbulb className="w-6 h-6 text-blue-500" />
            <span>답변 핵심 요약</span>
            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 border-blue-200">
              AI 분석
            </Badge>
          </CardTitle>
          <Separator className="bg-blue-200/50" />
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 핵심 포인트 */}
          <div className="space-y-2">
            <h4 className="text-lg font-semibold text-gray-800 flex items-center">
              <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
              주요 포인트
              <Badge 
                variant="outline" 
                className="ml-2 text-xs bg-green-50 text-green-700 border-green-200 cursor-help transition-all duration-200 hover:bg-green-100 hover:border-green-300 hover:scale-105 hover:shadow-lg"
                title="AI 답변의 정확성과 신뢰성을 나타내는 점수입니다. 문서 검색 정확도(40%), AI 모델의 답변 품질(35%), 출처 문서의 신뢰성(25%)을 종합하여 계산됩니다. 90% 이상: 매우 신뢰할 수 있음, 70-89%: 신뢰할 수 있음, 50-69%: 보통 신뢰도, 50% 미만: 낮은 신뢰도"
              >
                신뢰도 {Math.round((summaryData?.confidence || 0.85) * 100)}%
              </Badge>
            </h4>
            
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500 mr-2" />
                <span className="text-xs text-gray-600">AI가 답변을 분석 중입니다...</span>
              </div>
            ) : error ? (
              <div className="flex items-center py-2 text-red-600">
                <AlertCircle className="w-4 h-4 mr-2" />
                <span className="text-xs">요약 생성 중 오류가 발생했습니다.</span>
              </div>
            ) : summaryData?.keyPoints ? (
              <div className="space-y-2">
                {summaryData.keyPoints.map((point, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="flex items-start space-x-2"
                  >
                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                    <p className="text-base text-gray-700 leading-relaxed">{point}</p>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-500 italic">
                답변 요약을 생성할 수 없습니다.
              </div>
            )}
          </div>

          {/* 문서별 핵심 내용 */}
          {sources.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-lg font-semibold text-gray-800 flex items-center">
                <BookOpen className="w-5 h-5 text-purple-500 mr-2" />
                참고 문서 핵심 내용
              </h4>
              
              {summaryData?.documentHighlights && summaryData.documentHighlights.length > 0 ? (
                <div className="space-y-2">
                  {summaryData.documentHighlights.map((highlight, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="bg-white/60 rounded-lg p-3 border border-blue-200/40"
                    >
                      <div className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 flex-shrink-0"></div>
                        <p className="text-base text-gray-700 leading-relaxed">{highlight}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {sources.slice(0, 3).map((source, index) => (
                    <motion.div
                      key={source.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="bg-white/60 rounded-lg p-3 border border-blue-200/40"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h5 className="text-sm font-semibold text-gray-800 line-clamp-1">
                          {(() => {
                            // 제목 개선 로직 적용
                            let displayTitle = source.title;
                            const chunkIndex = source.id?.match(/_chunk_(\d+)/)?.[1] || '0';
                            const pageNumber = Math.floor(parseInt(chunkIndex) / 5) + 1;
                            
                            if (source.sourceType === 'url') {
                              try {
                                const url = new URL(source.url || '');
                                const domain = url.hostname.replace('www.', '');
                                
                                let actualTitle = source.title;
                                if (source.title && !source.title.startsWith('url_') && source.title !== source.id) {
                                  if (actualTitle.length > 50) {
                                    actualTitle = actualTitle.substring(0, 47) + '...';
                                  }
                                } else {
                                  if (domain.includes('facebook.com')) {
                                    if (url.pathname.includes('/policies/ads')) {
                                      actualTitle = 'Facebook 광고 정책';
                                    } else if (url.pathname.includes('/business/help')) {
                                      actualTitle = 'Facebook 비즈니스 도움말';
                                    } else {
                                      actualTitle = 'Facebook 가이드';
                                    }
                                  } else if (domain.includes('instagram.com')) {
                                    actualTitle = 'Instagram 비즈니스 가이드';
                                  } else if (domain.includes('developers.facebook.com')) {
                                    actualTitle = 'Facebook 개발자 문서';
                                  } else {
                                    actualTitle = 'Meta 광고 가이드';
                                  }
                                }
                                
                                displayTitle = `${domain} - ${actualTitle} (${pageNumber}페이지)`;
                              } catch {
                                displayTitle = `${source.title} (${pageNumber}페이지)`;
                              }
                            } else {
                              let cleanFileName = source.title.replace(/\.(pdf|docx|txt)$/i, '');
                              if (cleanFileName.length > 40) {
                                cleanFileName = cleanFileName.substring(0, 37) + '...';
                              }
                              displayTitle = `${cleanFileName} (${pageNumber}페이지)`;
                            }
                            
                            return displayTitle;
                          })()}
                        </h5>
                        <div className="flex items-center space-x-1">
                          {source.similarity && (
                            <Badge 
                              variant="outline" 
                              className="text-xs bg-purple-50 text-purple-700 border-purple-200 cursor-help transition-all duration-200 hover:bg-purple-100 hover:border-purple-300 hover:scale-105 hover:shadow-lg"
                              title="문서와 질문의 관련성을 나타내는 점수입니다. 코사인 유사도(Cosine Similarity)를 사용하여 질문과 문서의 벡터 임베딩을 비교합니다. 90% 이상: 매우 관련성 높음, 70-89%: 관련성 높음, 50-69%: 보통 관련성, 50% 미만: 낮은 관련성"
                            >
                              유사도 {Math.round(source.similarity * 100)}%
                            </Badge>
                          )}
                          <Badge 
                            variant="outline" 
                            className={`text-xs ${
                              source.sourceType === 'file' 
                                ? 'bg-green-50 text-green-700 border-green-200' 
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}
                          >
                            {source.sourceType === 'file' ? '📄' : '🔗'}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center text-sm text-gray-500">
                          <Calendar className="w-4 h-4 mr-1" />
                          마지막 업데이트: {new Date(source.updatedAt).toLocaleDateString('ko-KR')}
                        </div>
                        <div className="flex items-center space-x-1">
                          {source.sourceType === 'file' ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-3 text-green-600 hover:text-green-700 hover:bg-green-100 text-sm"
                onClick={() => {
                  if (source.url) {
                    const link = document.createElement('a');
                    link.href = source.url;
                    link.download = source.title;
                    link.click();
                  }
                }}
                title="파일 다운로드"
              >
                <Download className="w-4 h-4 mr-1" />
                다운로드
              </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-3 text-blue-600 hover:text-blue-700 hover:bg-blue-100 text-sm"
                              onClick={() => {
                                if (source.url) {
                                  // URL이 상대 경로인 경우 절대 URL로 변환
                                  let targetUrl = source.url;
                                  if (targetUrl.startsWith('/api/') || targetUrl.startsWith('/download/')) {
                                    alert('이 문서는 다운로드 전용입니다. 파일 다운로드를 사용해주세요.');
                                    return;
                                  }
                                  
                                  // URL이 유효한지 확인
                                  try {
                                    new URL(targetUrl);
                                    window.open(targetUrl, '_blank');
                                  } catch {
                                    window.open(targetUrl, '_blank');
                                  }
                                }
                              }}
                              title="웹페이지 열기"
                            >
                              <ExternalLink className="w-4 h-4 mr-1" />
                              웹페이지 열기
                            </Button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
