'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Send,
  Bot,
  User,
  Loader2,
  MessageSquare,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Copy,
  Check
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
  id: string;
  title: string;
  content: string;
  similarity: number;
  url?: string;
  updatedAt: string;
  excerpt: string;
  sourceType?: 'file' | 'url';
  documentType?: string;
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
      content: '안녕하세요! Meta 광고 정책과 가이드라인에 대해 궁금한 것이 있으시면 언제든지 질문해주세요. 예를 들어 "Facebook 광고 정책은 무엇인가요?" 또는 "Instagram 비즈니스 계정 설정 방법" 등을 물어보실 수 있습니다.',
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

  const handleSendMessage = useCallback(async () => {
    if (!inputMessage.trim() || isLoading) return;

    // 중복 요청 방지: 마지막 메시지가 같은 내용인지 확인
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.type === 'user' && lastMessage.content === inputMessage.trim()) {
      console.log('⚠️ 중복 요청 방지: 동일한 메시지가 이미 전송되었습니다.');
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: inputMessage.trim(),
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
      console.log('🚀 챗봇 스트림 API 호출 시작:', inputMessage.trim());

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: inputMessage.trim() }),
      });

      console.log('📡 API 응답 상태:', response.status, response.statusText);

      if (!response.ok) {
        console.error('❌ API 응답 오류:', response.status, response.statusText);
        throw new Error(`서버 오류: ${response.status} ${response.statusText}`);
      }

      // 스트리밍 응답 처리
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('스트림을 읽을 수 없습니다.');
      }

      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        while (buffer.length > 0) {
          const dataIndex = buffer.indexOf('data: ');
          if (dataIndex === -1) break;

          buffer = buffer.slice(dataIndex);
          const nextDataIndex = buffer.indexOf('\n\ndata: ', 6);
          const doubleNewlineIndex = buffer.indexOf('\n\n', 6);

          let dataEndIndex: number;
          if (nextDataIndex !== -1) {
            dataEndIndex = nextDataIndex;
          } else if (doubleNewlineIndex !== -1) {
            dataEndIndex = doubleNewlineIndex;
          } else {
            break;
          }

          const dataBlock = buffer.slice(6, dataEndIndex).trim();
          buffer = buffer.slice(dataEndIndex + 2);

          if (!dataBlock) continue;

          try {
            let jsonStr = dataBlock;
            if (jsonStr.startsWith('data: ')) {
              jsonStr = jsonStr.slice(6).trim();
            }
            // 제어 문자 제거
            jsonStr = jsonStr.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

            const data = JSON.parse(jsonStr);

            if (data.type === 'chunk') {
              fullContent += data.data?.content || '';
              setMessages(prev => prev.map(msg =>
                msg.id === botMessageId
                  ? { ...msg, content: fullContent }
                  : msg
              ));
            } else if (data.type === 'done') {
              setMessages(prev => prev.map(msg =>
                msg.id === botMessageId
                  ? {
                    ...msg,
                    content: fullContent,
                    sources: data.data?.sources || [],
                    confidence: data.data?.confidence || 0,
                    processingTime: data.data?.processingTime || 0,
                    noDataFound: data.data?.noDataFound || false,
                    showContactOption: data.data?.showContactOption || false
                  }
                  : msg
              ));
            } else if (data.type === 'error') {
              throw new Error(data.data?.message || '답변 생성 중 오류가 발생했습니다.');
            }
          } catch (parseError) {
            console.error('❌ JSON 파싱 오류:', parseError);
            continue;
          }
        }
      }

    } catch (error) {
      console.error('❌ 챗봇 응답 오류:', error);

      let errorContent = '죄송합니다. 답변을 생성하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

      if (error instanceof Error) {
        if (error.message.includes('서버 오류')) {
          errorContent = '서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
        } else if (error.message.includes('빈 응답')) {
          errorContent = '서버 응답에 문제가 있습니다. 관리자에게 문의해주세요.';
        } else if (error.message.includes('JSON 파싱')) {
          errorContent = '서버 응답 형식에 문제가 있습니다. 관리자에게 문의해주세요.';
        } else {
          errorContent = `오류: ${error.message}`;
        }
      }

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'bot',
        content: errorContent,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, errorMessage]);
      toast.error('챗봇 응답 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [inputMessage, isLoading]);

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
        handleSendMessage();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [initialQuestion]);

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
    <div className={`h-full flex flex-col bg-gray-900 ${className}`}>
      {/* 메시지 영역 */}
      <ScrollArea className="flex-1 px-6 py-4 chat-scrollbar">
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'
                }`}
            >
              {message.type === 'bot' && (
                <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-medium">AI</span>
                </div>
              )}

              <div
                className={`max-w-[80%] rounded-lg px-4 py-3 ${message.type === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-white'
                  }`}
              >
                <div className="whitespace-pre-wrap leading-relaxed text-sm">{message.content}</div>

                {/* 봇 메시지 추가 정보 */}
                {message.type === 'bot' && (
                  <div className="mt-3 space-y-2">
                    {/* 출처 정보 */}
                    {message.sources && message.sources.length > 0 && (
                      <div className="mt-2">
                        <div className="text-xs text-gray-400 mb-1">출처 {message.sources.length}개 보기</div>
                        <div className="space-y-1">
                          {message.sources.slice(0, 2).map((source, index) => (
                            <div key={index} className="text-xs bg-gray-700 rounded p-2">
                              <div className="font-medium text-white">{source.title}</div>
                              <div className="text-gray-300">{source.content}</div>
                              <div className="flex items-center justify-between mt-1">
                                <span className="text-gray-400">유사도: {source.similarity}%</span>
                                {source.url && (
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-400 hover:underline flex items-center gap-1"
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

                    {/* 피드백 버튼들 */}
                    <div className="flex items-center space-x-2 mt-2">
                      <button className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                        👍 도움됨
                      </button>
                      <button className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                        👎 도움안됨
                      </button>
                      <button className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                        ⭐ 즐겨찾기
                      </button>
                      <span className="text-xs text-gray-500 ml-2">
                        {formatTime(message.timestamp)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {message.type === 'user' && (
                <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-white" />
                </div>
              )}
            </div>
          ))}

          {/* 로딩 인디케이터 */}
          {isLoading && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-medium">AI</span>
              </div>
              <div className="bg-gray-800 rounded-lg px-4 py-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span className="text-white text-sm">답변을 생성하고 있습니다...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <Separator className="bg-gray-700" />

      {/* 입력 영역 */}
      <div className="p-4">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Meta 광고 정책에 대해 질문해보세요..."
            disabled={isLoading}
            className="flex-1 bg-gray-800 border-gray-700 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputMessage.trim() || isLoading}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

