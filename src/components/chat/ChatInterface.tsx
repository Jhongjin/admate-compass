'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  Send, 
  User, 
  Loader2, 
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Copy,
  Check,
  Bookmark,
  ClipboardCheck,
  FileText,
  Search,
  ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';

interface Message {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: Date;
  sources?: ChatSource[];
  confidence?: number;
  processingTime?: number;
  noDataFound?: boolean;
  showContactOption?: boolean;
}

interface ChatSource {
  title: string;
  content?: string;
  excerpt?: string;
  similarity?: number;
  url?: string;
  sourceType?: 'file' | 'url';
}

interface ChatInterfaceProps {
  className?: string;
  initialQuestion?: string;
}

export function ChatInterface({ className, initialQuestion }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'bot',
      content: 'Compass 정책 확인 화면입니다. 플랫폼, 정책 항목, 소재 표현을 함께 적어주시면 확인 가능한 출처와 정책 답변을 분리해서 정리합니다.',
      timestamp: new Date()
    }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 메시지 목록이 업데이트될 때마다 스크롤을 맨 아래로
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const formatConfidence = (confidence?: number) => {
    if (typeof confidence !== 'number' || Number.isNaN(confidence)) return null;

    const normalized = confidence > 1 ? confidence : confidence * 100;
    return Math.max(0, Math.min(100, Math.round(normalized)));
  };

  const formatSimilarity = (similarity?: number) => {
    if (typeof similarity !== 'number' || Number.isNaN(similarity)) return null;

    const normalized = similarity > 1 ? similarity : similarity * 100;
    return `${Math.max(0, Math.min(100, Math.round(normalized)))}%`;
  };

  const getSourceExcerpt = (source: ChatSource) => {
    return source.content || source.excerpt || '표시 가능한 원문 일부가 없습니다. 원문 링크가 있으면 원문에서 확인해 주세요.';
  };

  const requestContactReview = (question: string) => {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(new CustomEvent('sendContactEmail', {
      detail: { question }
    }));
    toast.success('담당자 확인 요청을 준비했습니다.');
  };

  const sendMessage = useCallback(async (messageText?: string) => {
    const trimmedMessage = (messageText ?? inputMessage).trim();
    if (!trimmedMessage || isLoading) return;

    // 중복 요청 방지: 마지막 메시지가 같은 내용인지 확인
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.type === 'user' && lastMessage.content === trimmedMessage) {
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: trimmedMessage,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    // 스트림 응답을 위한 봇 메시지 초기화
    const botMessageId = (Date.now() + 1).toString();
    const botMessage: Message = {
      id: botMessageId,
      type: 'bot',
      content: '',
      timestamp: new Date(),
      sources: [],
      confidence: 0,
      processingTime: 0
    };

    setMessages(prev => [...prev, botMessage]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: trimmedMessage }),
      });

      if (!response.ok) {
        throw new Error(`서버 오류: ${response.status}`);
      }

      // 일반 JSON 응답 처리
      const data = await response.json();
      
      setMessages(prev => prev.map(msg => 
        msg.id === botMessageId 
          ? { 
              ...msg, 
              content: data.response?.message || data.message || '답변을 생성할 수 없습니다.',
              sources: data.response?.sources || data.sources || [],
              confidence: data.confidence || 0,
              processingTime: data.processingTime || 0,
              noDataFound: data.response?.noDataFound || false,
              showContactOption: data.response?.showContactOption || false
            }
          : msg
      ));

    } catch (error) {
      let errorContent = '죄송합니다. 답변을 생성하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      
      if (error instanceof Error) {
        if (error.message.includes('서버 오류')) {
          errorContent = '서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
        } else if (error.message.includes('빈 응답')) {
          errorContent = '서버 응답에 문제가 있습니다. 관리자에게 문의해주세요.';
        } else if (error.message.includes('JSON 파싱')) {
          errorContent = '서버 응답 형식에 문제가 있습니다. 관리자에게 문의해주세요.';
        } else {
          errorContent = '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
        }
      }
      
      setMessages(prev => prev.map(msg =>
        msg.id === botMessageId
          ? {
              ...msg,
              content: errorContent,
              sources: [],
              confidence: 0,
              processingTime: 0,
              noDataFound: false,
              showContactOption: false
            }
          : msg
      ));
      toast.error('챗봇 응답 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [inputMessage, isLoading, messages]);

  const handleSendMessage = useCallback(() => {
    void sendMessage();
  }, [sendMessage]);

  // 입력창에 포커스
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 초기 질문이 있으면 자동으로 처리
  useEffect(() => {
    if (initialQuestion && initialQuestion.trim() && messages.length === 1) {
      // 초기 메시지만 있을 때만 실행 (중복 방지)
      setInputMessage(initialQuestion);
      const timer = setTimeout(() => {
        void sendMessage(initialQuestion);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [initialQuestion, messages.length, sendMessage]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const copyToClipboard = async (text: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      toast.success('클립보드에 복사되었습니다.');
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (error) {
      toast.error('복사에 실패했습니다.');
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('ko-KR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden bg-[#F7F8F2] text-[#111713] ${className ?? ''}`}>
      <div className="border-b border-[#D8DCCF] bg-[#FBFBF7] px-3 py-3 sm:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#758070]">
              <ClipboardCheck className="h-3.5 w-3.5 text-[#1F7A4D]" />
              출처 확인
            </div>
            <p className="mt-1 text-sm font-semibold text-[#111713]">질문, 정책 답변, 출처 문서를 한 화면에서 대조합니다.</p>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-[11px] text-[#5F6C62] sm:min-w-[280px]">
            <div className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1.5">
              <span className="block font-semibold text-[#111713]">{messages.filter((message) => message.type === 'user').length}</span>
              질문
            </div>
            <div className="rounded-md border border-[#C6D9CB] bg-[#EDF7EF] px-2 py-1.5">
              <span className="block font-semibold text-[#1F7A4D]">{messages.reduce((count, message) => count + (message.sources?.length || 0), 0)}</span>
              출처
            </div>
            <div className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1.5">
              <span className="block font-semibold text-[#111713]">{isLoading ? '검토중' : '대기'}</span>
              상태
            </div>
          </div>
        </div>
      </div>

      {/* 메시지 영역 */}
      <ScrollArea className="flex-1 px-3 py-4 sm:px-5">
        <div className="mx-auto max-w-5xl space-y-4">
          {messages.map((message, messageIndex) => {
            const previousUserQuestion = [...messages.slice(0, messageIndex)].reverse().find((item) => item.type === 'user')?.content || message.content;

            return (
            <div
              key={message.id}
              className={`flex min-w-0 gap-2 sm:gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.type === 'bot' && (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF]">
                  <ShieldCheck className="h-4 w-4 text-[#1F7A4D]" />
                </div>
              )}
              
              <div
                className={`min-w-0 rounded-lg border px-3 py-3 shadow-sm sm:px-4 ${
                  message.type === 'user'
                    ? 'max-w-[88%] border-[#111713] bg-[#111713] text-white sm:max-w-2xl'
                    : 'w-full max-w-4xl border-[#D6D8CD] bg-white text-[#111713]'
                }`}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      message.type === 'user'
                        ? 'border-white/20 bg-white/10 text-white'
                        : 'border-[#C6D9CB] bg-[#EDF7EF] text-[#1F7A4D]'
                    }`}
                  >
                    {message.type === 'user' ? '정책 질문' : '정책 답변'}
                  </Badge>
                  {message.type === 'bot' && message.sources && message.sources.length > 0 && (
                    <Badge variant="outline" className="rounded-md border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                      출처 연결
                    </Badge>
                  )}
                  {message.type === 'bot' && message.noDataFound && (
                    <Badge variant="outline" className="rounded-md border-[#E9D59B] bg-[#FFF8E6] px-2 py-0.5 text-[11px] text-[#8A6418]">
                      출처 없음
                    </Badge>
                  )}
                  <span className={`text-[11px] ${message.type === 'user' ? 'text-white/55' : 'text-[#777777]'}`}>
                    {formatTime(message.timestamp)}
                  </span>
                </div>

                {message.content ? (
                  <div className={`whitespace-pre-wrap text-sm leading-6 ${message.type === 'user' ? 'text-white' : 'text-[#242A25]'}`}>
                    {message.content}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-[#5F6C62]">
                      <Loader2 className="h-4 w-4 animate-spin text-[#1F7A4D]" />
                      출처 문서와 정책 문맥을 대조하는 중입니다.
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="h-2 rounded-full bg-[#E9ECE3]" />
                      <div className="h-2 rounded-full bg-[#E9ECE3]" />
                      <div className="h-2 rounded-full bg-[#E9ECE3]" />
                    </div>
                  </div>
                )}
                
                {/* 봇 메시지 추가 정보 */}
                {message.type === 'bot' && (
                  <div className="mt-4 space-y-3">
                    {message.noDataFound && (
                      <div className="rounded-lg border border-[#E9D59B] bg-[#FFF8E6] p-3 text-xs leading-5 text-[#6B5316]">
                        <div className="mb-1 flex items-center gap-2 font-semibold text-[#111713]">
                          <Search className="h-3.5 w-3.5 text-[#9E5700]" />
                          확인 가능한 출처가 없습니다
                        </div>
                        더 구체적으로 입력하면 관련 문서를 다시 확인할 수 있습니다.
                        {message.showContactOption && (
                          <button
                            type="button"
                            onClick={() => requestContactReview(previousUserQuestion)}
                            className="mt-3 inline-flex rounded-md border border-[#E9D59B] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B5316] transition-colors hover:bg-[#FFF3CF]"
                          >
                            담당자 확인 요청
                          </button>
                        )}
                      </div>
                    )}

                    {/* 출처 정보 */}
                    {message.sources && message.sources.length > 0 && (
                      <div className="rounded-lg border border-[#D8DCCF] bg-[#FBFBF7] p-3">
                        <div className="mb-2 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                          <div className="flex items-center gap-2 text-xs font-semibold text-[#111713]">
                            <FileText className="h-4 w-4 text-[#1F7A4D]" />
                            확인한 출처 {message.sources.length}개 보기
                          </div>
                          <span className="text-[11px] text-[#758070]">최종 판단 전 원문 대조</span>
                        </div>
                        <div className="space-y-2">
                          {message.sources.slice(0, 2).map((source, index) => (
                            <div key={index} className="rounded-md border border-[#D8DCCF] bg-white p-3 text-xs">
                              <div className="flex items-start gap-2">
                                <div className="flex h-6 w-6 flex-none items-center justify-center rounded-md border border-[#C6D9CB] bg-[#EDF7EF] font-semibold text-[#1F7A4D]">
                                  {index + 1}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="line-clamp-2 break-words font-semibold leading-5 text-[#111713]">{source.title}</div>
                                  <div className="mt-1 line-clamp-3 leading-5 text-[#5F6C62]">{getSourceExcerpt(source)}</div>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                                <span className="rounded-md border border-[#D8DCCF] bg-[#FBFBF7] px-2 py-1 text-[#5F6C62]">
                                  관련도 {formatSimilarity(source.similarity) || '확인 전'}
                                </span>
                                {source.url && (
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 self-start rounded-md px-2 py-1 text-[#1F7A4D] transition-colors hover:bg-[#EDF7EF]"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    원문 보기
                                  </a>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!message.noDataFound && message.content && (!message.sources || message.sources.length === 0) && (
                      <div className="rounded-lg border border-[#D8DCCF] bg-[#FBFBF7] p-3 text-xs leading-5 text-[#5F6C62]">
                        <div className="mb-1 flex items-center gap-2 font-semibold text-[#111713]">
                          <FileText className="h-3.5 w-3.5 text-[#758070]" />
                          출처 확인 대기
                        </div>
                        이 답변에는 표시 가능한 출처가 없습니다. 정책 판단에는 추가 원문 확인이 필요합니다.
                      </div>
                    )}

                    {(message.confidence !== undefined || message.processingTime !== undefined) && message.content && (
                      <div className="grid gap-2 rounded-lg border border-[#D8DCCF] bg-white p-3 text-xs text-[#5F6C62] sm:grid-cols-2">
                        <div>
                          <div className="mb-1 flex items-center gap-1 font-semibold text-[#111713]">
                            <ClipboardCheck className="h-3.5 w-3.5 text-[#1F7A4D]" />
                            출처 일치도
                          </div>
                          {formatConfidence(message.confidence) !== null ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full bg-[#E9ECE3]">
                                <div
                                  className="h-1.5 rounded-full bg-[#1F7A4D]"
                                  style={{ width: `${formatConfidence(message.confidence)}%` }}
                                />
                              </div>
                              <span className="font-semibold text-[#111713]">{formatConfidence(message.confidence)}%</span>
                            </div>
                          ) : (
                            <span>확인 전</span>
                          )}
                        </div>
                        <div className="sm:text-right">
                          <div className="font-semibold text-[#111713]">검토 시간</div>
                          <span>{message.processingTime ? `${message.processingTime}ms` : '기록 없음'}</span>
                        </div>
                      </div>
                    )}
                    
                    {/* 피드백 버튼들 */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button className="inline-flex items-center gap-1 rounded-md border border-[#D8DCCF] bg-white px-2 py-1 text-xs text-[#5F6C62] transition-colors hover:bg-[#EDF7EF] hover:text-[#1F7A4D]">
                        <ThumbsUp className="h-3.5 w-3.5" />
                        검토에 유용
                      </button>
                      <button className="inline-flex items-center gap-1 rounded-md border border-[#D8DCCF] bg-white px-2 py-1 text-xs text-[#5F6C62] transition-colors hover:bg-[#FFF8E6] hover:text-[#8A6418]">
                        <ThumbsDown className="h-3.5 w-3.5" />
                        출처 부족
                      </button>
                      <button className="inline-flex items-center gap-1 rounded-md border border-[#D8DCCF] bg-white px-2 py-1 text-xs text-[#5F6C62] transition-colors hover:bg-[#F5F4EC] hover:text-[#111713]">
                        <Bookmark className="h-3.5 w-3.5" />
                        보관
                      </button>
                      <button
                        onClick={() => copyToClipboard(message.content, message.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-[#D8DCCF] bg-white px-2 py-1 text-xs text-[#5F6C62] transition-colors hover:bg-[#F5F4EC] hover:text-[#111713]"
                      >
                        {copiedMessageId === message.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        복사
                      </button>
                    </div>
                  </div>
                )}
              </div>
              
              {message.type === 'user' && (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#111713]">
                  <User className="w-4 h-4 text-white" />
                </div>
              )}
            </div>
          )})}
          
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>
      
      <Separator className="bg-[#D8DCCF]" />
      
      {/* 입력 영역 */}
      <div className="border-t border-[#E2E4D9] bg-[#FBFBF7] p-3 sm:p-4">
        <div className="mx-auto flex max-w-5xl min-w-0 gap-2">
          <Input
            ref={inputRef}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="플랫폼, 정책 항목, 소재 표현을 함께 입력하세요..."
            disabled={isLoading}
            className="h-11 min-w-0 flex-1 rounded-lg border-[#C9CDBF] bg-white text-[#111713] placeholder:text-[#758070] focus:border-[#1F7A4D] focus:ring-2 focus:ring-[#C6D9CB]"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputMessage.trim() || isLoading}
            className="h-11 flex-none rounded-lg bg-[#111713] px-4 text-white transition-colors hover:bg-[#243028] disabled:bg-[#A8B0A7]"
            aria-label="질문 보내기"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="mx-auto mt-2 flex max-w-5xl flex-wrap items-center gap-2 text-[11px] text-[#758070]">
          <FileText className="h-3.5 w-3.5 text-[#1F7A4D]" />
          예: Google Ads 금융상품 문구, Meta 전후비교 이미지, 네이버 의료 광고 랜딩 조건
        </div>
      </div>
    </div>
  );
}

