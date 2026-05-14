"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, Calendar, FileText, User, Download, Globe, Bot, Clock, Activity, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Source {
  id: string;
  title: string;
  url?: string;
  updatedAt: string;
  excerpt: string;
  sourceType?: 'file' | 'url';
  documentType?: string;
  retrievalMethod?: string;
  corpus?: string;
  evidenceType?: string;
  sourceVendor?: string;
  score?: number;
  hybridScore?: number;
  similarity?: number;
  sourceQuality?: {
    hasDocumentId?: boolean;
    hasTitle?: boolean;
    hasUrl?: boolean;
    hasExcerpt?: boolean;
    isFallback?: boolean;
    warnings?: string[];
    qualityScore?: number;
    sourceVendor?: string;
    vendorMatch?: boolean;
    vendorMismatch?: boolean;
    lexicalOverlap?: number;
  };
}

interface ChatBubbleProps {
  type: "user" | "assistant";
  content: string;
  timestamp: string;
  sources?: Source[];
  feedback?: {
    helpful: boolean | null;
    count: number;
  };
  onFeedback?: (helpful: boolean) => void;
  noDataFound?: boolean;
  showContactOption?: boolean;
  confidence?: number;
  processingTime?: number;
  model?: string;
}

export default function ChatBubble({
  type,
  content,
  timestamp,
  sources = [],
  feedback,
  onFeedback,
  noDataFound = false,
  showContactOption = false,
  confidence,
  processingTime,
  model,
}: ChatBubbleProps) {
  const [showSources, setShowSources] = useState(false);

  const isUser = type === "user";
  const hasVerifiedSources = sources.length > 0 && !noDataFound;
  const generationLimited = model === 'ollama-connection-failed';

  const getEvidenceLabel = (source: Source) => {
    const method = source.retrievalMethod?.toLowerCase();

    if (method?.includes('hybrid')) return '의미+문구 근거';
    if (method?.includes('keyword')) return '문구 일치 근거';
    if (method?.includes('vector')) return '의미 유사 근거';

    return '검증 근거';
  };

  const getSourceAccessLabel = (source: Source) => {
    if (source.url || source.sourceQuality?.hasUrl) return '원문 확인 가능';
    if (source.excerpt || source.sourceQuality?.hasExcerpt) return '원문 일부 확인 가능';

    return '내부 색인 문서';
  };

  const getCorpusLabel = (source: Source) => {
    const corpus = source.corpus?.toLowerCase();

    if (corpus?.includes('document_chunks')) return '내부 색인 문서';
    if (corpus?.includes('ollama_document_chunks')) return '정책 근거 색인';

    return 'Compass 색인';
  };

  const getDisplayTitle = (source: Source, index: number) => {
    const cleanedTitle = source.title?.replace(/_chunk_\d+/g, `_page_${index + 1}`).trim();
    return cleanedTitle || `근거 문서 ${index + 1}`;
  };

  const getSourceScore = (source: Source) => {
    const rawScore = source.hybridScore ?? source.score ?? source.similarity ?? source.sourceQuality?.qualityScore;

    if (typeof rawScore !== 'number' || Number.isNaN(rawScore)) {
      return null;
    }

    const normalized = rawScore > 1 ? rawScore : rawScore * 100;
    return `${Math.round(normalized)}%`;
  };

  // 파일 다운로드 핸들러
  const handleFileDownload = async (source: Source) => {
    try {
      if (!source.url) {
        console.error('다운로드 URL이 없습니다:', source);
        alert('다운로드할 파일의 URL을 찾을 수 없습니다.');
        return;
      }

      console.log(`📥 파일 다운로드 시도: ${source.url}`);

      // 파일명 생성
      const fileName = source.title.replace(/_chunk_\d+/g, (match) => {
        const chunkNumber = match.match(/\d+/)?.[0] || '1';
        return `_page_${chunkNumber}`;
      });

      // 파일 다운로드
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new Error(`파일 다운로드 실패: ${response.status} ${response.statusText}`);
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      console.log(`📥 파일 다운로드 완료: ${fileName}`);
    } catch (error) {
      console.error('❌ 파일 다운로드 실패:', error);
      alert(`파일 다운로드에 실패했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    }
  };

  // URL 링크 핸들러
  const handleUrlOpen = (source: Source) => {
    if (source.url) {
      console.log(`🌐 웹페이지 열기: ${source.url}`);
      window.open(source.url, '_blank');
    } else {
      console.error('웹페이지 URL이 없습니다:', source);
      alert('열 수 있는 웹페이지 URL을 찾을 수 없습니다.');
    }
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3 sm:mb-4`}>
      <div className={`max-w-[92%] sm:max-w-3xl ${isUser ? "order-2" : "order-1"}`}>
        {isUser ? (
          <div className="px-3 py-2 sm:px-4 sm:py-3">
            <div className="flex items-start space-x-2 sm:space-x-3">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#111713] sm:h-8 sm:w-8">
                <User className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
              </div>
              
              <div className="flex-1 min-w-0">
                <div
                  className="rounded-lg border border-[#111713] px-3 py-2 text-white shadow-sm sm:px-4 sm:py-3"
                  style={{ backgroundColor: '#111713' }}
                >
                  <div className="text-sm sm:text-sm leading-relaxed text-white prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {content}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-3 py-2 sm:px-4 sm:py-3">
            <div className="flex items-start space-x-2 sm:space-x-3">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-[#C6D9CB] bg-[#EDF7EF] sm:h-8 sm:w-8">
                <Bot className="h-3 w-3 text-[#1F7A4D] sm:h-4 sm:w-4" />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="rounded-lg border border-[#D6D8CD] bg-white p-4 text-[#111713] shadow-sm">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-md border-[#C6D9CB] bg-[#EDF7EF] px-2 py-0.5 text-[11px] font-medium text-[#1F7A4D]">
                      Compass 답변
                    </Badge>
                    {hasVerifiedSources && (
                      <Badge variant="outline" className="rounded-md border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        근거 문서 확인
                      </Badge>
                    )}
                    {generationLimited && hasVerifiedSources && (
                      <Badge variant="outline" className="rounded-md border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        생성 답변 일시 제한
                      </Badge>
                    )}
                  </div>

                  {generationLimited && hasVerifiedSources && (
                    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                      답변 생성은 일시적으로 제한되었지만, 관련 근거 문서를 찾았습니다. 아래 근거를 먼저 확인해 주세요.
                    </div>
                  )}

                  {noDataFound && (
                    <div className="mb-3 rounded-md border border-[#D8DCCF] bg-[#FBFBF7] px-3 py-2 text-xs leading-relaxed text-[#5F6C62]">
                      현재 Compass 문서 기준으로 확인 가능한 근거를 찾지 못했습니다. 플랫폼명이나 정책 항목을 조금 더 구체적으로 입력해 주세요.
                    </div>
                  )}

                  <div className="prose prose-sm max-w-none text-sm leading-relaxed text-[#1F1F1F] prose-headings:text-[#111713] prose-strong:text-[#111713] prose-a:text-[#1F7A4D] prose-li:my-0.5">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {content}
                    </ReactMarkdown>
                  </div>
                </div>
                
                {/* Sources for assistant messages */}
                {sources.length > 0 && (
                  <div className="mt-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowSources(!showSources)}
                      className="h-auto rounded-lg border border-[#C6D9CB] bg-white p-2 text-xs font-medium text-[#1F7A4D] shadow-sm transition-colors hover:bg-[#EDF7EF] hover:text-[#176B42]"
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      근거 문서 {sources.length}개 보기
                      <span className="ml-1 text-[#1F7A4D]">
                        {showSources ? '▲' : '▼'}
                      </span>
                    </Button>
                    
                    {showSources && (
                      <div className="mt-3 space-y-3">
                        {sources.map((source, index) => (
                          <Card key={source.id} className="rounded-lg border-[#D8DCCF] bg-[#FBFBF7] shadow-sm transition-colors hover:border-[#9AB9A3]">
                            <CardContent className="p-4">
                              <div className="flex items-start gap-3">
                                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-[#C6D9CB] bg-[#EDF7EF] text-xs font-semibold text-[#1F7A4D]">
                                  {index + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <h4 className="text-sm font-semibold leading-snug text-[#111713]">
                                      {getDisplayTitle(source, index)}
                                    </h4>
                                    <div className="flex flex-shrink-0 items-center gap-1">
                                      {source.url && (
                                        <>
                                          {source.sourceType === 'file' ? (
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-8 rounded-md px-2 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                                              onClick={() => handleFileDownload(source)}
                                              title="파일 다운로드"
                                            >
                                              <Download className="w-4 h-4" />
                                            </Button>
                                          ) : (
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-8 rounded-md px-2 text-xs text-[#1F7A4D] hover:bg-[#EDF7EF] hover:text-[#176B42]"
                                              onClick={() => handleUrlOpen(source)}
                                              title="웹페이지 열기"
                                            >
                                              <Globe className="w-4 h-4" />
                                            </Button>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <p className="mb-3 line-clamp-4 text-sm leading-relaxed text-[#3F3F3F]">
                                    {source.excerpt}
                                  </p>
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#5F6C62]">
                                      <span className="inline-flex items-center gap-1">
                                        <Calendar className="h-3.5 w-3.5" />
                                        {new Date(source.updatedAt).toLocaleDateString('ko-KR')}
                                      </span>
                                      <span className="inline-flex items-center gap-1">
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                        {getSourceAccessLabel(source)}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge variant="secondary" className="rounded-md border border-[#C6D9CB] bg-[#EDF7EF] px-2 py-1 text-[11px] font-medium text-[#1F7A4D]">
                                        {getEvidenceLabel(source)}
                                      </Badge>
                                      <Badge variant="outline" className="rounded-md border-[#D8DCCF] bg-white px-2 py-1 text-[11px] text-[#5F6C62]">
                                        {getCorpusLabel(source)}
                                      </Badge>
                                      {getSourceScore(source) && (
                                        <Badge variant="outline" className="rounded-md border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
                                          관련도 {getSourceScore(source)}
                                        </Badge>
                                      )}
                                      {source.sourceType === 'file' ? (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 rounded-md px-2 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                                          onClick={() => handleFileDownload(source)}
                                          title="파일 다운로드"
                                        >
                                          <Download className="w-4 h-4 mr-2" />
                                          다운로드
                                        </Button>
                                      ) : (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 rounded-md px-2 text-xs text-[#1F7A4D] hover:bg-[#EDF7EF] hover:text-[#176B42]"
                                          onClick={() => handleUrlOpen(source)}
                                          title="웹페이지 열기"
                                        >
                                          <Globe className="w-4 h-4 mr-2" />
                                          웹페이지
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                
                {/* Contact option for no data found */}
                {showContactOption && (
                  <Card className="mt-3 rounded-lg border-amber-200 bg-amber-50">
                    <CardContent className="p-4">
                      <div className="flex items-start space-x-3">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 rounded-md border border-amber-200 bg-white flex items-center justify-center">
                            <span className="text-amber-700 text-sm font-bold">!</span>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold text-amber-950 mb-1">
                            추가 확인이 필요한 질문입니다
                          </h4>
                          <p className="text-xs text-amber-800 mb-3">
                            Compass 문서 기준으로 충분한 근거를 찾지 못했습니다. 담당자에게 문의하면 더 정확한 확인을 받을 수 있습니다.
                          </p>
                          <Button
                            onClick={() => {
                              // 직접 메일 발송
                              if (typeof window !== 'undefined') {
                                const event = new CustomEvent('sendContactEmail', { 
                                  detail: { question: content } 
                                });
                                window.dispatchEvent(event);
                              }
                            }}
                            className="w-full rounded-md bg-[#111713] py-2 text-sm text-white transition-colors hover:bg-[#243028]"
                          >
                            담당자에게 문의하기
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Runtime status */}
                {(confidence !== undefined || processingTime !== undefined || model) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#5F6C62]">
                    {confidence !== undefined && (
                      <span className="flex items-center gap-1 rounded-md border border-[#D8DCCF] bg-white px-2 py-1">
                        <Activity className="h-3 w-3" />
                        근거 신뢰도 {Math.round(confidence)}%
                      </span>
                    )}
                    {processingTime !== undefined && (
                      <span className="flex items-center gap-1 rounded-md border border-[#D8DCCF] bg-white px-2 py-1">
                        <Clock className="h-3 w-3" />
                        {processingTime}ms
                      </span>
                    )}
                    {model && (
                      <span className="flex items-center gap-1 rounded-md border border-[#D8DCCF] bg-white px-2 py-1">
                        <Bot className="h-3 w-3" />
                        {generationLimited ? '생성 답변 제한' : '생성 답변 완료'}
                      </span>
                    )}
                  </div>
                )}

                {/* Feedback buttons for assistant messages */}
                {feedback && onFeedback && (
                  <div className="flex items-center space-x-2 mt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onFeedback(true)}
                      className={`h-auto rounded-md border p-2 text-xs transition-colors ${
                        feedback.helpful === true
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-[#D8DCCF] bg-white text-[#5F6C62] hover:bg-[#EDF7EF] hover:text-[#1F7A4D]"
                      }`}
                    >
                      <ThumbsUp className="w-3 h-3 mr-1" />
                      <span className="hidden sm:inline">도움됨</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onFeedback(false)}
                      className={`h-auto rounded-md border p-2 text-xs transition-colors ${
                        feedback.helpful === false
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-[#D8DCCF] bg-white text-[#5F6C62] hover:bg-red-50 hover:text-red-700"
                      }`}
                    >
                      <ThumbsDown className="w-3 h-3 mr-1" />
                      <span className="hidden sm:inline">도움안됨</span>
                    </Button>
                    <span className="text-xs text-[#777777]">{timestamp}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
