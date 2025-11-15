"use client";

import { useState, useRef, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import MainLayout from "@/components/layouts/MainLayout";
import ChatBubble from "@/components/chat/ChatBubble";
import HistoryPanel from "@/components/chat/HistoryPanel";
import QuickQuestions from "@/components/chat/QuickQuestions";
import RelatedResources from "@/components/chat/RelatedResources";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Send, Bot, User, Star, ThumbsUp, ThumbsDown, RotateCcw, AlertCircle, CheckCircle, History, FileText, Target, Lightbulb, BookOpen, MessageSquare, Trash2, RefreshCw, PanelLeft, PanelRight, Maximize2, Minimize2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { logger } from "@/lib/utils/logger";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: string;
  sources?: Array<{
    id: string;
    title: string;
    url?: string;
    updatedAt: string;
    excerpt: string;
  }>;
  feedback?: {
    helpful: boolean | null;
    count: number;
  };
  noDataFound?: boolean;
  showContactOption?: boolean;
  relatedQuestions?: string[];
}

function ChatPageContent() {
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [vendorFilter, setVendorFilter] = useState<string[] | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedMessageIds, setSavedMessageIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(65);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false);
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [hasProcessedInitialQuestion, setHasProcessedInitialQuestion] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isMobileLeftOpen, setIsMobileLeftOpen] = useState(false);
  const [isMobileRightOpen, setIsMobileRightOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();


  const handleResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    
    const startX = e.clientX;
    const startWidth = leftPanelWidth;
    
    const handleMouseMove = (e: MouseEvent) => {
      const containerWidth = window.innerWidth;
      const deltaX = e.clientX - startX;
      const deltaPercent = (deltaX / containerWidth) * 100;
      const newWidth = Math.min(Math.max(startWidth + deltaPercent, 20), 80);
      setLeftPanelWidth(newWidth);
    };
    
    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [leftPanelWidth]);

  const toggleRightPanel = useCallback(() => {
    setIsRightPanelCollapsed(prev => {
      if (!prev) {
        setLeftPanelWidth(100);
      } else {
        setLeftPanelWidth(50);
      }
      return !prev;
    });
  }, []);

  const toggleLeftPanel = useCallback(() => {
    setIsLeftPanelCollapsed(prev => !prev);
  }, []);

  // 초기 메시지 설정
  useEffect(() => {
    if (!isInitialized) {
      setMessages([
        {
          id: "1",
          type: "assistant",
          content: "안녕하세요! 멀티 플랫폼 광고 FAQ AI 챗봇입니다. Meta, Naver, Kakao, Google, X 등 다양한 광고 플랫폼의 정책, 가이드라인, 설정 방법 등에 대해 궁금한 점이 있으시면 자유롭게 질문해주세요. 한국어로 질문하시면 됩니다.",
          timestamp: "방금 전",
          sources: [],
        },
      ]);
      setIsInitialized(true);
    }
  }, [isInitialized]);


  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    setIsMobile(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleMediaChange);
      return () => mediaQuery.removeEventListener("change", handleMediaChange);
    }

    mediaQuery.addListener(handleMediaChange);
    return () => mediaQuery.removeListener(handleMediaChange);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setIsRightPanelCollapsed(true);
    } else {
      setIsMobileLeftOpen(false);
      setIsMobileRightOpen(false);
    }
  }, [isMobile]);

  // 로그인 상태 확인
  useEffect(() => {
    if (!loading && !user) {
      // 로그인하지 않은 사용자는 메인 페이지로 리다이렉트
      window.location.href = '/';
    }
  }, [loading, user]);

  useEffect(() => {
    const question = searchParams?.get('q');
    const vendorsParam = searchParams?.get('vendors');
    
    // 벤더 필터 파라미터 처리
    if (vendorsParam) {
      const vendors = vendorsParam.split(',').map(v => v.trim()).filter(Boolean);
      setVendorFilter(vendors.length > 0 ? vendors : null);
    }
    
    if (question && question.trim() && isInitialized && messages.length === 1 && user && !hasProcessedInitialQuestion) {
      // 초기화 완료 후 초기 메시지만 있을 때만 실행 (중복 방지)
      setHasProcessedInitialQuestion(true);
      setInputValue(question);
      setTimeout(() => {
        handleSendMessageWithQuestion(question);
        const url = new URL(window.location.href);
        url.searchParams.delete('q');
        url.searchParams.delete('vendors');
        window.history.replaceState({}, '', url.toString());
      }, 200);
    }
  }, [searchParams, isInitialized, user, hasProcessedInitialQuestion]); // hasProcessedInitialQuestion 추가

  // 자동 메일 발송 이벤트 리스너 - 안전한 이벤트 처리
  useEffect(() => {
    const handleSendContactEmail = (event: Event) => {
      try {
        // 이벤트 객체를 안전하게 직렬화하여 처리
        let eventData: any = null;
        
        if (event && typeof event === 'object') {
          // CustomEvent인지 확인
          if ('detail' in event) {
            const customEvent = event as CustomEvent;
            eventData = customEvent.detail;
          } else {
            // 일반 이벤트인 경우 타겟에서 데이터 추출
            const target = event.target;
            if (target instanceof HTMLElement && target.dataset) {
              eventData = target.dataset;
            }
          }
        }

        // 이벤트 데이터 검증 및 처리
        if (eventData && 
            typeof eventData === 'object' && 
            eventData !== null &&
            'question' in eventData &&
            typeof eventData.question === 'string' &&
            eventData.question.trim()) {
          
          logger.log('연락처 이메일 이벤트 처리:', eventData.question);
          handleContactRequest(eventData.question, eventData.aiResponse);
        } else {
          logger.warn('유효하지 않은 이벤트 데이터:', {
            hasEventData: !!eventData,
            dataType: typeof eventData,
            hasQuestion: eventData && 'question' in eventData,
            questionType: eventData && typeof eventData.question,
            questionValue: eventData && eventData.question
          });
        }
      } catch (error) {
        logger.error('연락처 이메일 이벤트 처리 중 오류:', error);
        // 오류 발생 시에도 앱이 중단되지 않도록 처리
      }
    };

    // 이벤트 리스너 등록
    window.addEventListener('sendContactEmail', handleSendContactEmail);
    
    return () => {
      window.removeEventListener('sendContactEmail', handleSendContactEmail);
    };
  }, [messages]);

  const messagesRef = useRef(messages);
  const savedMessageIdsRef = useRef(savedMessageIds);
  const userRef = useRef(user);
  const isSavingRef = useRef(isSaving);

  useEffect(() => {
    messagesRef.current = messages;
    savedMessageIdsRef.current = savedMessageIds;
    userRef.current = user;
    isSavingRef.current = isSaving;
  });

  useEffect(() => {
    let isUnmounting = false;
    
    const saveConversationOnUnmount = async () => {
      if (isUnmounting || isSavingRef.current) {
        return;
      }
      
      isUnmounting = true;
      
      const currentUser = userRef.current;
      const currentMessages = messagesRef.current;
      const currentSavedIds = savedMessageIdsRef.current;
      
      if (currentUser && currentMessages.length > 1) {
        try {
          const userMessages = currentMessages.filter(msg => msg.type === 'user');
          const aiMessages = currentMessages.filter(msg => msg.type === 'assistant');
          
          const conversationPairs = [];
          for (let i = 0; i < Math.min(userMessages.length, aiMessages.length); i++) {
            const userMsg = userMessages[i];
            const aiMsg = aiMessages[i];
            
            if (!currentSavedIds.has(userMsg.id) && !currentSavedIds.has(aiMsg.id)) {
              conversationPairs.push({ userMsg, aiMsg });
            }
          }
          
          if (conversationPairs.length === 0) {
            return;
          }
          
          let savedCount = 0;
          for (const { userMsg, aiMsg } of conversationPairs) {
            const uniqueId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${userMsg.id}_${aiMsg.id}`;
            
            const response = await fetch('/api/conversations', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                userId: currentUser.id,
                conversationId: uniqueId,
                userMessage: userMsg.content,
                aiResponse: aiMsg.content,
                sources: aiMsg.sources || [],
              }),
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.success) {
                savedCount++;
              }
            }
          }
        } catch (error) {
          logger.error('세션 종료 시 대화 히스토리 저장 오류:', error);
        }
      }
    };

    const handleBeforeUnload = () => {
      saveConversationOnUnmount();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      saveConversationOnUnmount();
    };
  }, []);

  // 공통 스트리밍 응답 처리 함수 (useCallback으로 메모이제이션하지 않음 - 내부에서 setMessages 등을 사용하므로)
  const processStreamingResponse = async (
    question: string,
    userMessage: Message,
    aiResponseId: string,
    aiResponse: Message,
    currentMessages: Message[]
  ) => {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: question.trim(),
        conversationHistory: currentMessages.slice(-10),
        vendors: vendorFilter,
      }),
    });

    if (!response.ok) {
      let errorMessage = '응답을 받는 중 오류가 발생했습니다.';
      try {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } else {
          const errorText = await response.text();
          errorMessage = errorText || errorMessage;
        }
      } catch (parseError) {
        logger.error('❌ 에러 응답 파싱 실패:', parseError);
      }
      throw new Error(errorMessage);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    if (!reader) {
      throw new Error('스트림을 읽을 수 없습니다.');
    }

    setMessages(prev => [...prev, aiResponse]);

    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        if (buffer.trim()) {
          logger.warn('⚠️ 스트림 종료 시 남은 버퍼:', buffer.substring(0, 100));
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      
      while (buffer.length > 0) {
        const dataIndex = buffer.indexOf('data: ');
        if (dataIndex === -1) {
          break;
        }

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

        if (!dataBlock) {
          continue;
        }

        let jsonStr = dataBlock;
        
        if (jsonStr.startsWith('data: ')) {
          jsonStr = jsonStr.slice(6).trim();
        }
        
        jsonStr = jsonStr.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

        try {
          if (!jsonStr || jsonStr.length === 0) {
            continue;
          }
          
          const trimmedJson = jsonStr.trim();
          if (!trimmedJson.startsWith('{') && !trimmedJson.startsWith('[')) {
            continue;
          }
          
          const data = JSON.parse(jsonStr);
          
          if (!data || typeof data !== 'object') {
            continue;
          }
          
          if (data.type === 'chunk') {
            fullContent += data.data?.content || '';
            setMessages(prev => prev.map(msg => 
              msg.id === aiResponseId 
                ? { ...msg, content: fullContent }
                : msg
            ));
          } else if (data.type === 'done') {
            setMessages(prev => prev.map(msg => 
              msg.id === aiResponseId 
                ? { 
                    ...msg, 
                    content: fullContent,
                    sources: data.data?.sources || [],
                    noDataFound: data.data?.noDataFound || false,
                    showContactOption: data.data?.showContactOption || false,
                    relatedQuestions: data.data?.relatedQuestions || []
                  }
                : msg
            ));
          } else if (data.type === 'error') {
            throw new Error(data.data?.message || '답변 생성 중 오류가 발생했습니다.');
          }
        } catch (parseError) {
          logger.error('❌ JSON 파싱 오류:', parseError);
          continue;
        }
      }
    }

    // 대화 자동 저장
    if (user && fullContent) {
      try {
        const finalMessage = currentMessages.find(msg => msg.id === aiResponseId) || aiResponse;
        const uniqueId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${userMessage.id}_${aiResponseId}`;
        
        const saveResponse = await fetch('/api/conversations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: user.id,
            conversationId: uniqueId,
            userMessage: userMessage.content,
            aiResponse: fullContent,
            sources: finalMessage.sources || [],
          }),
        });
        
        if (saveResponse.ok) {
          const saveData = await saveResponse.json();
          if (saveData.success) {
            savedMessageIds.add(userMessage.id);
            savedMessageIds.add(aiResponseId);
            logger.log('대화가 자동으로 저장되었습니다.');
          }
        }
      } catch (saveError) {
        logger.error('대화 자동 저장 오류:', saveError);
      }
    }

    return fullContent;
  };

  const handleSendMessageWithQuestion = useCallback(async (question: string) => {
    if (!question.trim() || isLoading) return;

    const existingUserMessage = messages.find(msg => 
      msg.type === 'user' && msg.content.trim() === question.trim()
    );
    
    if (existingUserMessage) {
      logger.log('이미 같은 질문이 있습니다. 중복을 방지합니다.');
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: question.trim(),
      timestamp: new Date().toLocaleTimeString('ko-KR', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
    };

    setIsLoading(true);
    setError(null);
    setMessages(prev => [...prev, userMessage]);

    const aiResponseId = (Date.now() + 1).toString();
    const aiResponse: Message = {
      id: aiResponseId,
      type: "assistant",
      content: '',
      timestamp: new Date().toLocaleTimeString('ko-KR', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      sources: [],
      feedback: { helpful: null, count: 0 },
      noDataFound: false,
      showContactOption: false
    };

    try {
      await processStreamingResponse(question, userMessage, aiResponseId, aiResponse, [...messages, userMessage]);
    } catch (error) {
      logger.error('❌ 채팅 API 오류:', error);
      
      if (error instanceof SyntaxError) {
        logger.error('❌ JSON 파싱 오류 상세:', {
          message: error.message,
          stack: error.stack,
          name: error.name
        });
      }
      
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      let userFriendlyMessage = errorMessage;
      if (errorMessage.includes('Unexpected token') || errorMessage.includes('JSON') || errorMessage.includes('data:')) {
        userFriendlyMessage = '서버 응답을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      }
      
      setError(userFriendlyMessage);
      
      const errorMessageObj: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: `죄송합니다. 현재 서비스에 일시적인 문제가 발생했습니다.\n\n${userFriendlyMessage}\n\n잠시 후 다시 시도해주세요.`,
        timestamp: new Date().toLocaleTimeString('ko-KR', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        sources: [],
        feedback: { helpful: null, count: 0 },
      };

      setMessages(prev => [...prev, errorMessageObj]);
      
      toast({
        title: "오류 발생",
        description: "AI 응답을 받는 중 문제가 발생했습니다.",
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setIsLoading(false);
      setInputValue("");
    }
  }, [messages, vendorFilter, user, isLoading, savedMessageIds, toast]);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const existingUserMessage = messages.find(msg => 
      msg.type === 'user' && msg.content.trim() === inputValue.trim()
    );
    
    if (existingUserMessage) {
      logger.log('이미 같은 질문이 있습니다. 중복을 방지합니다.');
      return;
    }

    const currentInput = inputValue.trim();
    setInputValue("");

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: currentInput,
      timestamp: new Date().toLocaleTimeString('ko-KR', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
    };

    setIsLoading(true);
    setError(null);
    setMessages(prev => [...prev, userMessage]);

    const aiResponseId = (Date.now() + 1).toString();
    const aiResponse: Message = {
      id: aiResponseId,
      type: "assistant",
      content: '',
      timestamp: new Date().toLocaleTimeString('ko-KR', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      sources: [],
      feedback: { helpful: null, count: 0 },
      noDataFound: false,
      showContactOption: false
    };

    try {
      await processStreamingResponse(currentInput, userMessage, aiResponseId, aiResponse, [...messages, userMessage]);
    } catch (error) {
      logger.error('❌ 채팅 API 오류:', error);
      
      if (error instanceof SyntaxError) {
        logger.error('❌ JSON 파싱 오류 상세:', {
          message: error.message,
          stack: error.stack,
          name: error.name
        });
      }
      
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      let userFriendlyMessage = errorMessage;
      if (errorMessage.includes('Unexpected token') || errorMessage.includes('JSON') || errorMessage.includes('data:')) {
        userFriendlyMessage = '서버 응답을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      }
      
      setError(userFriendlyMessage);
      
      const errorMessageObj: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: `죄송합니다. 현재 서비스에 일시적인 문제가 발생했습니다.\n\n${userFriendlyMessage}\n\n잠시 후 다시 시도해주세요.`,
        timestamp: new Date().toLocaleTimeString('ko-KR', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        sources: [],
        feedback: { helpful: null, count: 0 },
      };

      setMessages(prev => [...prev, errorMessageObj]);
      
      toast({
        title: "오류 발생",
        description: "AI 응답을 받는 중 문제가 발생했습니다.",
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setIsLoading(false);
      setInputValue("");
    }
  }, [messages, vendorFilter, user, isLoading, inputValue, savedMessageIds, toast]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  const handleContactRequest = useCallback(async (question: string, aiResponse?: string) => {
    // 실제 질문 찾기 (마지막 사용자 메시지)
    const lastUserMessage = messages.filter(msg => msg.type === 'user').pop();
    const actualQuestion = lastUserMessage?.content || question;
    
    // AI 답변 찾기 (마지막 assistant 메시지)
    const lastAiMessage = messages.filter(msg => msg.type === 'assistant').pop();
    const actualAiResponse = aiResponse || lastAiMessage?.content || '';
    
    // 사용자 정보 가져오기
    const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || '사용자';
    const userEmail = user?.email || '';

    setIsSendingEmail(true);
    
    // 메일 발송 중 메시지 추가
    const sendingMessage: Message = {
      id: `sending-${Date.now()}`,
      type: "assistant",
      content: "📧 페이스북 담당팀에 문의 메일을 발송 중입니다...",
      timestamp: new Date().toLocaleTimeString('ko-KR', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
    };
    
    setMessages(prev => [...prev, sendingMessage]);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: actualQuestion,
          aiResponse: actualAiResponse,
          userName,
          userEmail
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && data.emailLink) {
        // 이메일 클라이언트 열기
        logger.log('📧 메일 링크:', data.emailLink);
        try {
          // 새 창에서 메일 클라이언트 열기
          window.open(data.emailLink, '_blank');
        } catch (error) {
          logger.error('❌ 메일 클라이언트 열기 실패:', error);
          // 대안: 현재 창에서 열기
          window.location.href = data.emailLink;
        }
        
        // 성공 메시지로 교체
        const successMessage: Message = {
          id: `success-${Date.now()}`,
          type: "assistant",
          content: "✅ 페이스북 담당팀에 문의사항이 메일로 정상 발송되었습니다.\n\n📧 **발송 정보:**\n- 수신자: fb@nasmedia.co.kr\n- 문의 내용: " + actualQuestion.substring(0, 50) + (actualQuestion.length > 50 ? "..." : "") + "\n- 발송 시간: " + new Date().toLocaleString('ko-KR') + "\n\n💡 **메일 클라이언트가 열리지 않는다면:**\n직접 fb@nasmedia.co.kr로 메일을 보내주세요.\n\n담당팀에서 검토 후 답변을 드릴 예정입니다.",
          timestamp: new Date().toLocaleTimeString('ko-KR', { 
            hour: '2-digit', 
            minute: '2-digit' 
          }),
        };
        
        // 발송 중 메시지를 성공 메시지로 교체
        setMessages(prev => prev.map(msg => 
          msg.id === sendingMessage.id ? successMessage : msg
        ));
      }
    } catch (error) {
      logger.error("Error sending contact email:", error);
      
      // 실패 메시지로 교체
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        type: "assistant",
        content: "❌ 메일 발송 중 오류가 발생했습니다.\n\n**오류 내용:**\n" + (error instanceof Error ? error.message : "알 수 없는 오류") + "\n\n잠시 후 다시 시도해주시거나, 직접 fb@nasmedia.co.kr로 문의해주세요.",
        timestamp: new Date().toLocaleTimeString('ko-KR', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
      };
      
      // 발송 중 메시지를 실패 메시지로 교체
      setMessages(prev => prev.map(msg => 
        msg.id === sendingMessage.id ? errorMessage : msg
      ));
    } finally {
      setIsSendingEmail(false);
    }
  }, [messages, toast, user]);

  const handleNewChat = useCallback(async () => {
    if (isSaving) {
      return;
    }

    if (user && messages.length > 1) {
      setIsSaving(true);
      try {
        const userMessages = messages.filter(msg => msg.type === 'user');
        const aiMessages = messages.filter(msg => msg.type === 'assistant');
        
        const conversationPairs = [];
        for (let i = 0; i < Math.min(userMessages.length, aiMessages.length); i++) {
          const userMsg = userMessages[i];
          const aiMsg = aiMessages[i];
          
          if (!savedMessageIds.has(userMsg.id) && !savedMessageIds.has(aiMsg.id)) {
            conversationPairs.push({ userMsg, aiMsg });
          }
        }
        
        if (conversationPairs.length === 0) {
          logger.log('저장할 대화가 없습니다. 새 대화를 시작합니다.');
        }
        
        if (conversationPairs.length > 0) {
          let savedCount = 0;
          const newSavedIds = new Set<string>();
          
          for (const { userMsg, aiMsg } of conversationPairs) {
            const uniqueId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${userMsg.id}_${aiMsg.id}`;
            
            const response = await fetch('/api/conversations', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                userId: user.id,
                conversationId: uniqueId,
                userMessage: userMsg.content,
                aiResponse: aiMsg.content,
                sources: aiMsg.sources || [],
              }),
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.success) {
                savedCount++;
                newSavedIds.add(userMsg.id);
                newSavedIds.add(aiMsg.id);
              }
            }
          }
          
          if (newSavedIds.size > 0) {
            setSavedMessageIds(prev => new Set([...prev, ...newSavedIds]));
          }
          
          if (savedCount > 0) {
            logger.log(`${savedCount}개의 대화가 히스토리에 저장되었습니다.`);
            // 히스토리 패널 새로고침
            setHistoryRefreshTrigger(prev => prev + 1);
          }
        }
      } catch (error) {
        logger.error('대화 히스토리 저장 오류:', error);
        toast({
          title: "저장 실패",
          description: "대화 히스토리 저장에 실패했습니다.",
          variant: "destructive",
          duration: 2000,
        });
      } finally {
        setIsSaving(false);
      }
    }
    
    setMessages([
      {
        id: "1",
        type: "assistant",
        content: "안녕하세요! 멀티 플랫폼 광고 FAQ AI 챗봇입니다. Meta, Naver, Kakao, Google, X 등 다양한 광고 플랫폼의 정책, 가이드라인, 설정 방법 등에 대해 궁금한 점이 있으시면 자유롭게 질문해주세요. 한국어로 질문하시면 됩니다.",
        timestamp: "방금 전",
        sources: [],
      },
    ]);
    setError(null);
    setConversationId(null);
    setSavedMessageIds(new Set());
    setIsInitialized(true);
    
    // 히스토리 패널 새로고침 (저장된 대화가 없어도)
    setHistoryRefreshTrigger(prev => prev + 1);
  }, [user, messages, savedMessageIds, isSaving, toast]);

  const handleLoadConversation = useCallback(async (conversation: any) => {
    // 로딩 상태 시작
    setIsLoading(true);
    
    // 피드백 정보를 가져오는 함수
    const fetchFeedback = async (conversationId: string) => {
      if (!user?.id) return { helpful: null, count: 0 };
      
      try {
        const response = await fetch(`/api/feedback?userId=${encodeURIComponent(user.id)}&conversationId=${encodeURIComponent(conversationId)}`);
        if (response.ok) {
          const data = await response.json();
          // conversationId로 조회하면 배열이 반환되므로 첫 번째 피드백 사용
          if (data.feedback && Array.isArray(data.feedback) && data.feedback.length > 0) {
            const firstFeedback = data.feedback[0];
            return { helpful: firstFeedback.helpful, count: 1 };
          }
        }
      } catch (error) {
        logger.error('피드백 조회 오류:', error);
      }
      return { helpful: null, count: 0 };
    };

    try {
      // AI 응답 메시지의 피드백 정보 가져오기
      const conversationId = conversation.conversation_id || conversation.id;
      const feedback = await fetchFeedback(conversationId);

      setMessages([
        {
          id: "1",
          type: "assistant",
          content: "안녕하세요! 멀티 플랫폼 광고 FAQ AI 챗봇입니다. Meta, Naver, Kakao, Google, X 등 다양한 광고 플랫폼의 정책, 가이드라인, 설정 방법 등에 대해 궁금한 점이 있으시면 자유롭게 질문해주세요. 한국어로 질문하시면 됩니다.",
          timestamp: "방금 전",
          sources: [],
        },
        {
          id: "2",
          type: "user",
          content: conversation.user_message || conversation.title || "대화 내용",
          timestamp: new Date(conversation.createdAt || conversation.created_at).toLocaleTimeString('ko-KR', { 
            hour: '2-digit', 
            minute: '2-digit' 
          }),
        },
        {
          id: `ai_${conversationId}`,
          type: "assistant",
          content: conversation.ai_response || "AI 응답을 불러올 수 없습니다.",
          timestamp: new Date(conversation.createdAt || conversation.created_at).toLocaleTimeString('ko-KR', { 
            hour: '2-digit', 
            minute: '2-digit' 
          }),
          sources: conversation.sources || [],
          feedback: feedback,
        },
      ]);
      setConversationId(conversation.conversation_id);
      setHistoryOpen(false);
      setIsInitialized(true);
      
      // 성공 메시지 (toast 없이)
      logger.log('대화 로드 완료: 이전 대화를 불러왔습니다.');
    } catch (error) {
      logger.error('대화 로드 오류:', error);
      setError('대화를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
      // 입력창 비우기 (성공/실패 관계없이)
      setInputValue("");
    }
  }, [user]);

  const handleTextareaResize = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, []);

  useEffect(() => {
    handleTextareaResize();
  }, [inputValue]);

  const handleFeedback = useCallback(async (messageId: string, helpful: boolean) => {
    // 로그인 체크
    if (!user) {
      toast({
        title: "로그인 필요",
        description: "피드백을 남기려면 먼저 로그인해주세요.",
        variant: "destructive",
        duration: 3000,
      });
      return;
    }

    // 이미 같은 피드백이 있는지 확인
    const message = messages.find(msg => msg.id === messageId);
    if (message?.feedback?.helpful === helpful) {
      return; // 같은 피드백이면 무시
    }

    // UI 즉시 업데이트
    setMessages(prev => prev.map(msg => 
      msg.id === messageId 
        ? { 
            ...msg, 
            feedback: { 
              helpful, 
              count: msg.feedback?.helpful === null ? 1 : (msg.feedback?.count || 0) 
            } 
          }
        : msg
    ));

    // 서버에 피드백 저장 (sources 정보 포함)
    try {
      // 해당 메시지의 sources 정보 추출
      const messageSources = message?.sources || [];
      
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user?.id || "anonymous",
          conversationId: conversationId || `conv_${Date.now()}`,
          messageId: messageId,
          helpful: helpful,
          sources: messageSources // sources 정보 포함
        }),
      });

      if (!response.ok) {
        throw new Error('피드백 저장에 실패했습니다.');
      }

      const data = await response.json();
      if (!data.success) {
        logger.warn('피드백 저장 실패:', data.message);
      }
    } catch (error) {
      logger.error('피드백 저장 오류:', error);
      // 에러 발생 시 UI 롤백
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, feedback: { helpful: null, count: 0 } }
          : msg
      ));
    }
  }, [user, messages, conversationId, toast]);

  const handleQuickQuestionClick = useCallback((question: string) => {
    setInputValue(question);
    // 자동으로 메시지 전송
    setTimeout(() => {
      handleSendMessageWithQuestion(question);
    }, 100);
  }, [handleSendMessageWithQuestion]);

  const chatHeader = (
    <div className="bg-black/80 backdrop-blur-md border-b border-white/20 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-pink-500 rounded-full flex items-center justify-center shadow-lg">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white">
              멀티 플랫폼 광고 FAQ AI 챗봇
            </h2>
            <p className="text-xs sm:text-sm text-gray-200 font-medium hidden sm:block">
              챗봇 답변에 대한 만족도를 평가해주세요. 품질개선에 큰 도움이 됩니다.
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleRightPanel}
            className="hidden lg:flex items-center space-x-2 h-8 px-3 text-gray-200 hover:text-white hover:bg-gray-700/50 transition-all duration-200 rounded-md font-medium"
            aria-label={isRightPanelCollapsed ? "관련 자료 패널 펼치기" : "관련 자료 패널 접기"}
            aria-expanded={!isRightPanelCollapsed}
          >
            {isRightPanelCollapsed ? (
              <PanelRight className="w-4 h-4" aria-hidden="true" />
            ) : (
              <PanelLeft className="w-4 h-4" aria-hidden="true" />
            )}
            <span className="text-sm font-medium">
              {isRightPanelCollapsed ? "패널 펼치기" : "패널 접기"}
            </span>
          </Button>
          
          <Separator orientation="vertical" className="h-6 bg-gray-600 hidden lg:block" aria-hidden="true" />
          
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewChat}
            className="flex items-center space-x-2 h-8 px-2 sm:px-3 text-gray-200 hover:text-white hover:bg-gray-700/50 transition-all duration-200 rounded-md font-medium"
            aria-label="새 대화 시작"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="text-xs sm:text-sm font-medium hidden sm:inline">새 대화</span>
          </Button>
        </div>
      </div>
    </div>
  );

  // 로딩 중이거나 로그인하지 않은 경우
  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-[calc(100vh-8rem)] mt-32">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600">로그인 상태를 확인하는 중...</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!user) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-[calc(100vh-8rem)] mt-32">
          <div className="text-center">
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              <p className="font-bold">로그인이 필요합니다</p>
              <p className="text-sm">채팅 기능을 사용하려면 먼저 로그인해주세요.</p>
            </div>
            <p className="text-gray-600">잠시 후 메인 페이지로 이동합니다...</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout chatHeader={chatHeader}>
      <div className="flex h-[calc(100vh-8rem)] mt-16 sm:mt-32">
        {/* 1번 패널: 대화 히스토리 (데스크톱) */}
        {!isLeftPanelCollapsed && (
          <div className="hidden lg:block w-72 border-r border-gray-800/50 h-full">
            <HistoryPanel 
              onLoadConversation={handleLoadConversation}
              onNewChat={handleNewChat}
              userId={user?.id || "anonymous"}
              className="h-full"
              isCollapsed={isLeftPanelCollapsed}
              onToggle={toggleLeftPanel}
              refreshTrigger={historyRefreshTrigger}
            />
          </div>
        )}

        {isLeftPanelCollapsed && (
          <div className="hidden lg:block w-12 border-r border-gray-800/50 h-full">
            <HistoryPanel 
              onLoadConversation={handleLoadConversation}
              onNewChat={handleNewChat}
              userId={user?.id || "anonymous"}
              className="h-full"
              isCollapsed={isLeftPanelCollapsed}
              onToggle={toggleLeftPanel}
              refreshTrigger={historyRefreshTrigger}
            />
          </div>
        )}

        {/* 1번 패널: 모바일 Sheet */}
        {isMobile && (
          <Sheet open={isMobileLeftOpen} onOpenChange={setIsMobileLeftOpen}>
            <SheetContent side="left" className="w-[280px] sm:w-[320px] p-0">
              <HistoryPanel 
                onLoadConversation={(conv) => {
                  handleLoadConversation(conv);
                  setIsMobileLeftOpen(false);
                }}
                onNewChat={() => {
                  handleNewChat();
                  setIsMobileLeftOpen(false);
                }}
                userId={user?.id || "anonymous"}
                className="h-full"
                isCollapsed={false}
                onToggle={() => setIsMobileLeftOpen(false)}
                refreshTrigger={historyRefreshTrigger}
              />
            </SheetContent>
          </Sheet>
        )}
        
        {/* 모바일 히스토리 버튼 */}
        {isMobile && (
          <div className="fixed top-20 left-4 z-40">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMobileLeftOpen(true)}
              className="bg-gray-800/80 hover:bg-gray-700/80 text-white"
              aria-label="대화 히스토리 열기"
            >
              <History className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* 2번 패널: 채팅 영역 */}
        <motion.div 
          className="flex flex-col border-r border-gray-800/50 h-full lg:border-r w-full lg:w-auto"
          animate={{ 
            width: isRightPanelCollapsed ? '100%' : `${leftPanelWidth}%`,
            transition: isDragging ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }
          }}
        >
          <div className="h-2 sm:h-4"></div>

          <div 
            className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 space-y-3 sm:space-y-4 custom-scrollbar" 
            style={{ backgroundColor: '#212121' }}
            role="log"
            aria-live="polite"
            aria-label="채팅 메시지 목록"
          >
            {messages.map((message, index) => {
              // 해당 메시지의 사용자 질문 찾기
              let userQuestion = '';
              if (message.type === 'assistant' && message.showContactOption) {
                // 현재 메시지 이전의 사용자 메시지 찾기
                for (let i = index - 1; i >= 0; i--) {
                  if (messages[i].type === 'user') {
                    userQuestion = messages[i].content;
                    break;
                  }
                }
              }
              
              return (
                <ChatBubble
                  key={message.id}
                  type={message.type}
                  content={message.content}
                  timestamp={message.timestamp}
                  sources={message.sources}
                  feedback={message.feedback}
                  onFeedback={(helpful) => handleFeedback(message.id, helpful)}
                  noDataFound={message.noDataFound}
                  showContactOption={message.showContactOption}
                  userQuestion={userQuestion}
                />
              );
            })}
            
            {isLoading && (
              <div className="flex justify-start" role="status" aria-live="polite" aria-label="AI가 답변을 생성 중입니다">
                <div className="max-w-3xl">
                  <div className="card-enhanced px-4 py-3">
                    <div className="flex items-start space-x-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg" aria-hidden="true">
                        <span className="text-white text-sm font-medium">AI</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex space-x-1" aria-hidden="true">
                          <div className="w-2 h-2 bg-orange-400 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                          <div className="w-2 h-2 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                        </div>
                        <span className="sr-only">AI가 답변을 생성 중입니다</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
          </div>

          <div className="backdrop-blur-sm border-t border-gray-800/50 p-2 sm:p-3" style={{ backgroundColor: '#212121' }}>
            <div className="max-w-4xl mx-auto">
              <div className="flex space-x-2 sm:space-x-3">
                <div className="flex-1">
                  <Textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="메타 광고에 대해 궁금한 점을 질문해주세요..."
                    className="resize-none min-h-[44px] sm:min-h-[52px] max-h-[120px] sm:max-h-[144px] text-sm sm:text-base border-gray-600 text-white placeholder-gray-400 focus:border-gray-500"
                    style={{ backgroundColor: '#1a1a1a', borderRadius: '8px' }}
                    disabled={isLoading}
                    rows={1}
                    aria-label="질문 입력"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || isLoading}
                  className="h-11 w-11 sm:h-12 sm:w-12 p-0 bg-red-500 hover:bg-red-600 text-white shadow-lg rounded-full self-end flex-shrink-0"
                  aria-label="메시지 전송"
                >
                  <Send className="w-5 h-5 sm:w-6 sm:h-6" />
                </Button>
              </div>
              
              <div className="mt-2 sm:mt-3 flex items-center justify-between text-xs text-gray-400">
                <p className="hidden sm:block">Enter 키로 전송, Shift + Enter로 줄바꿈</p>
                <p className="sm:hidden text-[10px]">Enter로 전송</p>
                {error && (
                  <div className="flex items-center space-x-1 text-red-400" role="alert" aria-live="polite">
                    <AlertCircle className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span className="hidden sm:inline">연결 오류</span>
                    <span className="sm:hidden">오류</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {!isRightPanelCollapsed && (
          <div 
            className="w-1 bg-gray-800 hover:bg-orange-500 cursor-col-resize transition-colors duration-200 hidden lg:block"
            onMouseDown={handleResize}
            style={{ cursor: 'col-resize' }}
          />
        )}

        {/* 3번 패널: 관련 자료 표시 (데스크톱) */}
        <AnimatePresence>
          {!isRightPanelCollapsed && (
            <motion.div 
              initial={{ width: 0, opacity: 0 }}
              animate={{ 
                width: `${100 - leftPanelWidth}%`, 
                opacity: 1,
                transition: isDragging ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }
              }}
              exit={{ 
                width: 0, 
                opacity: 0,
                transition: { duration: 0.2, ease: "easeIn" }
              }}
              className="hidden lg:flex flex-col bg-gradient-to-b from-[#FDFBF6] to-[#FAF8F3] rounded-lg h-full overflow-hidden"
              style={{ borderRadius: '12px' }}
            >
              <div className="bg-gradient-to-r from-[#FDFBF6] to-[#FAF8F3] border-b border-orange-200/30 p-4">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center shadow-lg">
                    <BookOpen className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-black">관련 자료</h3>
                    <p className="text-sm text-gray-800">질문과 관련된 문서와 가이드라인</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* 질문이 있고 AI 응답이 완료된 경우에만 관련 자료와 빠른 질문 표시 */}
                {messages.length > 1 && !isLoading ? (
                  <>
                    {/* 관련 자료 컴포넌트 - 상단 배치 */}
                    <RelatedResources 
                      userQuestion={messages[messages.length - 2]?.content}
                      aiResponse={messages[messages.length - 1]?.content}
                      sources={messages[messages.length - 1]?.sources ?? []}
                      relatedQuestions={messages[messages.length - 1]?.relatedQuestions}
                      onQuestionClick={handleQuickQuestionClick}
                    />
                    {/* 빠른 질문 컴포넌트 - 하단 배치 (숨김 처리) */}
                    {false && (
                      <QuickQuestions 
                        onQuestionClick={handleQuickQuestionClick} 
                        currentQuestion={messages[messages.length - 2]?.content}
                      />
                    )}
                  </>
                ) : messages.length > 1 && isLoading ? (
                  /* AI 응답 로딩 중 - 로딩 상태 표시 */
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-20 h-20 bg-gradient-to-br from-orange-200 to-pink-200 rounded-full flex items-center justify-center mb-6">
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                        <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                      </div>
                    </div>
                    <h3 className="text-xl font-semibold text-gray-800 mb-3">AI가 답변을 생성 중입니다</h3>
                    <p className="text-sm text-gray-600 max-w-sm leading-relaxed">
                      답변이 완료되면 관련 자료와 핵심 요약이 여기에 표시됩니다.
                    </p>
                  </div>
                ) : (
                  /* 초기 상태 - 안내 메시지 */
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-20 h-20 bg-gradient-to-br from-orange-200 to-pink-200 rounded-full flex items-center justify-center mb-6">
                      <BookOpen className="w-10 h-10 text-orange-600" />
                    </div>
                    <h3 className="text-xl font-semibold text-gray-800 mb-3">질문을 시작해보세요</h3>
                    <p className="text-sm text-gray-600 max-w-sm leading-relaxed">
                      멀티 플랫폼 광고 정책, 타겟팅, 예산 설정 등에 대해 궁금한 점이 있으시면 
                      좌측 채팅창에서 질문해주세요. 관련 자료와 유사한 질문들이 
                      여기에 표시됩니다.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 3번 패널: 모바일 Sheet */}
        {isMobile && (
          <Sheet open={isMobileRightOpen} onOpenChange={setIsMobileRightOpen}>
            <SheetContent side="right" className="w-[90vw] sm:w-[400px] p-0 bg-gradient-to-b from-[#FDFBF6] to-[#FAF8F3]">
              <div className="h-full flex flex-col">
                <div className="bg-gradient-to-r from-[#FDFBF6] to-[#FAF8F3] border-b border-orange-200/30 p-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center shadow-lg">
                      <BookOpen className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-black">관련 자료</h3>
                      <p className="text-sm text-gray-800">질문과 관련된 문서와 가이드라인</p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.length > 1 && !isLoading ? (
                    <RelatedResources 
                      userQuestion={messages[messages.length - 2]?.content}
                      aiResponse={messages[messages.length - 1]?.content}
                      sources={messages[messages.length - 1]?.sources ?? []}
                      relatedQuestions={messages[messages.length - 1]?.relatedQuestions}
                      onQuestionClick={handleQuickQuestionClick}
                    />
                  ) : messages.length > 1 && isLoading ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-20 h-20 bg-gradient-to-br from-orange-200 to-pink-200 rounded-full flex items-center justify-center mb-6">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                          <div className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                        </div>
                      </div>
                      <h3 className="text-xl font-semibold text-gray-800 mb-3">AI가 답변을 생성 중입니다</h3>
                      <p className="text-sm text-gray-600 max-w-sm leading-relaxed">
                        답변이 완료되면 관련 자료와 핵심 요약이 여기에 표시됩니다.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-20 h-20 bg-gradient-to-br from-orange-200 to-pink-200 rounded-full flex items-center justify-center mb-6">
                        <BookOpen className="w-10 h-10 text-orange-600" />
                      </div>
                      <h3 className="text-xl font-semibold text-gray-800 mb-3">질문을 시작해보세요</h3>
                      <p className="text-sm text-gray-600 max-w-sm leading-relaxed">
                        멀티 플랫폼 광고 정책, 타겟팅, 예산 설정 등에 대해 궁금한 점이 있으시면 
                        좌측 채팅창에서 질문해주세요. 관련 자료와 유사한 질문들이 
                        여기에 표시됩니다.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        )}

        {/* 모바일 관련 자료 버튼 */}
        {isMobile && (
          <div className="fixed top-20 right-4 z-40">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMobileRightOpen(true)}
              className="bg-gray-800/80 hover:bg-gray-700/80 text-white"
              aria-label="관련 자료 열기"
            >
              <BookOpen className="w-4 h-4" />
            </Button>
          </div>
        )}
    </div>
    </MainLayout>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ChatPageContent />
    </Suspense>
  );
}