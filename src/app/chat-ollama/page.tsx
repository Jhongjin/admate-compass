"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import MainLayout from "@/components/layouts/MainLayout";
import ChatBubble from "@/components/chat/ChatBubble";
import HistoryPanel from "@/components/chat/HistoryPanel";
import QuickQuestions from "@/components/chat/QuickQuestions";
import SourceStatePanel from "@/components/chat/SourceStatePanel";
import type { ChatSource, ChatUiState } from "@/components/chat/chatUiStateTypes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Send, Bot, User, Star, ThumbsUp, ThumbsDown, RotateCcw, AlertCircle, CheckCircle, History, Target, Lightbulb, BookOpen, MessageSquare, Trash2, RefreshCw, PanelLeft, PanelRight, Maximize2, Minimize2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: string;
  sources?: ChatSource[];
  feedback?: {
    helpful: boolean | null;
    count: number;
  };
  noDataFound?: boolean;
  showContactOption?: boolean;
  confidence?: number;
  processingTime?: number;
  model?: string;
  uiState?: ChatUiState;
}

const INITIAL_GREETING = "안녕하세요. Compass Policy Desk입니다. 플랫폼, 정책 항목, 소재 유형을 함께 입력하면 확인 가능한 근거와 검토 포인트를 정리해 드립니다.";
const NO_DATA_MESSAGE = "Compass could not find usable evidence in current documents. Narrow the platform, policy item, or creative type and try again.";
const GENERATION_LIMITED_MESSAGE = "답변 생성이 일시적으로 제한되었습니다. 확인된 근거 문서는 아래에서 계속 확인할 수 있습니다.";
const ERROR_MESSAGE = "일시적인 서비스 오류로 답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";

const getInitialMessage = (): Message => ({
  id: "1",
  type: "assistant",
  content: INITIAL_GREETING,
  timestamp: "방금 전",
  sources: [],
});

const sanitizeSources = (sources: unknown): NonNullable<Message["sources"]> => {
  if (!Array.isArray(sources)) return [];

  return sources
    .filter((source) => source && typeof source === "object")
    .map((source, index) => {
      const item = source as Record<string, unknown>;
      const sourceQuality = item.sourceQuality && typeof item.sourceQuality === "object"
        ? item.sourceQuality as Record<string, unknown>
        : undefined;

      return {
        id: String(item.id || item.chunkId || item.documentId || `source-${index + 1}`),
        title: String(item.title || item.originalTitle || `근거 문서 ${index + 1}`),
        url: typeof item.url === "string" && item.url.trim() ? item.url : undefined,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
        excerpt: String(item.excerpt || item.content || ""),
        sourceType: typeof item.sourceType === "string" ? item.sourceType : undefined,
        isFallback: sourceQuality?.isFallback === true,
      };
    })
    .filter((source) => !source.isFallback && Boolean(source.title || source.excerpt))
    .map(({ isFallback, ...source }) => source);
};

function ChatPageContent() {
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [lastSubmittedQuestion, setLastSubmittedQuestion] = useState("");
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
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [hasProcessedInitialQuestion, setHasProcessedInitialQuestion] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();


  const handleResize = (e: React.MouseEvent) => {
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
  };

  const toggleRightPanel = () => {
    setIsRightPanelCollapsed(!isRightPanelCollapsed);
    if (!isRightPanelCollapsed) {
      setLeftPanelWidth(100);
    } else {
      setLeftPanelWidth(50);
    }
  };

  const toggleLeftPanel = () => {
    setIsLeftPanelCollapsed(!isLeftPanelCollapsed);
  };

  // 초기 메시지 설정
  useEffect(() => {
    if (!isInitialized) {
      setMessages([getInitialMessage()]);
      setIsInitialized(true);
    }
  }, [isInitialized]);


  useEffect(() => {
    const handleViewportResize = () => {
      const isMobile = window.innerWidth < 1024;
      setIsMobileLayout(isMobile);
      if (isMobile) {
        setIsRightPanelCollapsed(true);
      }
    };

    handleViewportResize();
    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, []);

  // 로그인 상태 확인
  useEffect(() => {
    if (!loading && !user) {
      // 로그인하지 않은 사용자는 Compass 로그인 화면으로 리다이렉트
      window.location.href = '/login?next=/chat-ollama';
    }
  }, [loading, user]);

  useEffect(() => {
    const question = searchParams?.get('q');
    if (question && question.trim() && isInitialized && messages.length === 1 && user && !hasProcessedInitialQuestion) {
      // 초기화 완료 후 초기 메시지만 있을 때만 실행 (중복 방지)
      setHasProcessedInitialQuestion(true);
      setInputValue(question);
      setTimeout(() => {
        handleSendMessageWithQuestion(question);
        const url = new URL(window.location.href);
        url.searchParams.delete('q');
        window.history.replaceState({}, '', url.toString());
      }, 200);
    }
  }, [searchParams, isInitialized, user, hasProcessedInitialQuestion]); // hasProcessedInitialQuestion 추가

  // 자동 메일 발송 이벤트 리스너
  useEffect(() => {
    const handleSendContactEmail = (event: CustomEvent) => {
      const { question } = event.detail;
      handleContactRequest(question);
    };

    window.addEventListener('sendContactEmail', handleSendContactEmail as EventListener);
    
    return () => {
      window.removeEventListener('sendContactEmail', handleSendContactEmail as EventListener);
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
          console.error('세션 종료 시 대화 히스토리 저장 오류:', error);
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

  const buildAssistantMessageFromResponse = (data: any): Message => {
    const safeSources = sanitizeSources(data?.response?.sources);
    const model = typeof data?.model === "string" ? data.model : undefined;
    const noDataFound = data?.response?.noDataFound === true && safeSources.length === 0;
    const generationLimited = model === "ollama-connection-failed" && safeSources.length > 0;
    const rawContent = data?.response?.message || data?.response?.content || "답변을 생성할 수 없습니다.";
    const uiState: ChatUiState | undefined = generationLimited ? "generation-limited" : noDataFound ? "noData" : undefined;

    return {
      id: (Date.now() + 1).toString(),
      type: "assistant",
      content: generationLimited ? GENERATION_LIMITED_MESSAGE : noDataFound ? NO_DATA_MESSAGE : String(rawContent),
      timestamp: new Date().toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit'
      }),
      sources: safeSources,
      feedback: { helpful: null, count: 0 },
      noDataFound,
      showContactOption: data?.response?.showContactOption === true,
      confidence: typeof data?.confidence === "number" ? data.confidence : undefined,
      processingTime: typeof data?.processingTime === "number" ? data.processingTime : undefined,
      model,
      uiState,
    };
  };

  const buildErrorMessage = (): Message => ({
    id: (Date.now() + 1).toString(),
    type: "assistant",
    content: ERROR_MESSAGE,
    timestamp: new Date().toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit'
    }),
    sources: [],
    feedback: { helpful: null, count: 0 },
    uiState: "error",
  });

  const handleSendMessageWithQuestion = async (question: string) => {
    if (!question.trim() || isLoading) return;

    // 이미 같은 질문이 있는지 확인
    const existingUserMessage = messages.find(msg => 
      msg.type === 'user' && msg.content.trim() === question.trim()
    );
    
    if (existingUserMessage) {
      console.log('이미 같은 질문이 있습니다. 중복을 방지합니다.');
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
    setLastSubmittedQuestion(question.trim());

    // 현재 메시지 상태를 기반으로 API 호출
    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);

    try {
      const response = await fetch('/api/chat-ollama', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: question.trim(),
          conversationHistory: messages.slice(-10), // 사용자 메시지 추가 전의 메시지들
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || '응답을 받는 중 오류가 발생했습니다.');
      }

      const aiResponse = buildAssistantMessageFromResponse(data);

      setMessages(prev => [...prev, aiResponse]);
      
      // 대화 자동 저장
      if (user) {
        try {
          const uniqueId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${userMessage.id}_${aiResponse.id}`;
          
          const saveResponse = await fetch('/api/conversations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userId: user.id,
              conversationId: uniqueId,
              userMessage: userMessage.content,
              aiResponse: aiResponse.content,
              sources: aiResponse.sources || [],
            }),
          });
          
          if (saveResponse.ok) {
            const saveData = await saveResponse.json();
            if (saveData.success) {
              // 저장된 메시지 ID 기록
              savedMessageIds.add(userMessage.id);
              savedMessageIds.add(aiResponse.id);
              console.log('대화가 자동으로 저장되었습니다.');
            }
          }
        } catch (saveError) {
          console.error('대화 자동 저장 오류:', saveError);
          // 저장 실패해도 사용자에게는 알리지 않음 (백그라운드 작업)
        }
      }

    } catch (error) {
      console.error('채팅 API 오류:', error);
      setError(ERROR_MESSAGE);
      setMessages(prev => [...prev, buildErrorMessage()]);
      
      toast({
        title: "오류 발생",
        description: "AI 응답을 받는 중 문제가 발생했습니다.",
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    // 이미 같은 질문이 있는지 확인
    const existingUserMessage = messages.find(msg => 
      msg.type === 'user' && msg.content.trim() === inputValue.trim()
    );
    
    if (existingUserMessage) {
      console.log('이미 같은 질문이 있습니다. 중복을 방지합니다.');
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: inputValue.trim(),
      timestamp: new Date().toLocaleTimeString('ko-KR', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
    };

    const currentInput = inputValue.trim();
    setInputValue("");
    setIsLoading(true);
    setError(null);
    setLastSubmittedQuestion(currentInput);

    // 현재 메시지 상태를 기반으로 API 호출
    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);

    try {
      const response = await fetch('/api/chat-ollama', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: currentInput,
          conversationHistory: messages.slice(-10), // 사용자 메시지 추가 전의 메시지들
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || '응답을 받는 중 오류가 발생했습니다.');
      }

      const aiResponse = buildAssistantMessageFromResponse(data);

      setMessages(prev => [...prev, aiResponse]);
      
      // 대화 자동 저장
      if (user) {
        try {
          const uniqueId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${userMessage.id}_${aiResponse.id}`;
          
          const saveResponse = await fetch('/api/conversations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userId: user.id,
              conversationId: uniqueId,
              userMessage: userMessage.content,
              aiResponse: aiResponse.content,
              sources: aiResponse.sources || [],
            }),
          });
          
          if (saveResponse.ok) {
            const saveData = await saveResponse.json();
            if (saveData.success) {
              // 저장된 메시지 ID 기록
              savedMessageIds.add(userMessage.id);
              savedMessageIds.add(aiResponse.id);
              console.log('대화가 자동으로 저장되었습니다.');
            }
          }
        } catch (saveError) {
          console.error('대화 자동 저장 오류:', saveError);
          // 저장 실패해도 사용자에게는 알리지 않음 (백그라운드 작업)
        }
      }

    } catch (error) {
      console.error('채팅 API 오류:', error);
      setError(ERROR_MESSAGE);
      setMessages(prev => [...prev, buildErrorMessage()]);
      
      toast({
        title: "오류 발생",
        description: "AI 응답을 받는 중 문제가 발생했습니다.",
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleRetry = () => {
    const latestQuestion = [...messages].reverse().find((message) => message.type === "user")?.content || "";
    const question = lastSubmittedQuestion || latestQuestion;
    if (!question.trim()) return;

    setInputValue(question);
    setError(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleContactRequest = async (question: string) => {
    // 실제 질문 찾기 (마지막 사용자 메시지)
    const lastUserMessage = messages.filter(msg => msg.type === 'user').pop();
    const actualQuestion = lastUserMessage?.content || question;

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
          question: actualQuestion
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && data.emailLink) {
        // 이메일 클라이언트 열기
        window.location.href = data.emailLink;
        
        // 성공 메시지로 교체
        const successMessage: Message = {
          id: `success-${Date.now()}`,
          type: "assistant",
          content: "✅ 페이스북 담당팀에 문의사항이 메일로 정상 발송되었습니다.\n\n📧 **발송 정보:**\n- 수신자: fb@nasmedia.co.kr\n- 문의 내용: " + actualQuestion.substring(0, 50) + (actualQuestion.length > 50 ? "..." : "") + "\n- 발송 시간: " + new Date().toLocaleString('ko-KR') + "\n\n담당팀에서 검토 후 답변을 드릴 예정입니다.",
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
      console.error("Error sending contact email:", error);
      
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
  };

  const handleNewChat = async () => {
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
          console.log('저장할 대화가 없습니다. 새 대화를 시작합니다.');
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
            console.log(`${savedCount}개의 대화가 히스토리에 저장되었습니다.`);
            // 히스토리 패널 새로고침
            setHistoryRefreshTrigger(prev => prev + 1);
          }
        }
      } catch (error) {
        console.error('대화 히스토리 저장 오류:', error);
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
    
    setMessages([getInitialMessage()]);
    setError(null);
    setLastSubmittedQuestion("");
    setConversationId(null);
    setSavedMessageIds(new Set());
    setIsInitialized(true);
    
    // 히스토리 패널 새로고침 (저장된 대화가 없어도)
    setHistoryRefreshTrigger(prev => prev + 1);
  };

  const handleLoadConversation = async (conversation: any) => {
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
        console.error('피드백 조회 오류:', error);
      }
      return { helpful: null, count: 0 };
    };

    try {
      // AI 응답 메시지의 피드백 정보 가져오기
      const conversationId = conversation.conversation_id || conversation.id;
      const feedback = await fetchFeedback(conversationId);

      setMessages([
        getInitialMessage(),
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
          sources: sanitizeSources(conversation.sources),
          feedback: feedback,
        },
      ]);
      setConversationId(conversation.conversation_id);
      setHistoryOpen(false);
      setIsInitialized(true);
      
      // 성공 메시지 (toast 없이)
      console.log('대화 로드 완료: 이전 대화를 불러왔습니다.');
    } catch (error) {
      console.error('대화 로드 오류:', error);
      setError('대화를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTextareaResize = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  useEffect(() => {
    handleTextareaResize();
  }, [inputValue]);

  const handleFeedback = async (messageId: string, helpful: boolean) => {
    // 로그인 체크
    if (!user) {
      alert('피드백을 남기려면 먼저 로그인해주세요.');
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

    // 서버에 피드백 저장
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user?.id || "anonymous",
          conversationId: conversationId || `conv_${Date.now()}`,
          messageId: messageId,
          helpful: helpful
        }),
      });

      if (!response.ok) {
        throw new Error('피드백 저장에 실패했습니다.');
      }

      const data = await response.json();
      if (!data.success) {
        console.warn('피드백 저장 실패:', data.message);
      }
    } catch (error) {
      console.error('피드백 저장 오류:', error);
      // 에러 발생 시 UI 롤백
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, feedback: { helpful: null, count: 0 } }
          : msg
      ));
    }
  };


  const handleQuickQuestionClick = (question: string) => {
    setInputValue(question);
    // 자동으로 메시지 전송
    setTimeout(() => {
      handleSendMessageWithQuestion(question);
    }, 100);
  };

  const latestAssistantMessage = [...messages].reverse().find((message) => message.type === "assistant");
  const latestUserMessage = [...messages].reverse().find((message) => message.type === "user");
  const latestSources = sanitizeSources(latestAssistantMessage?.sources || []);
  const latestHasSources = latestSources.length > 0;
  const latestNoDataFound = latestAssistantMessage?.noDataFound === true;
  const latestGenerationLimited = latestAssistantMessage?.uiState === "generation-limited" || (latestAssistantMessage?.model === "ollama-connection-failed" && latestHasSources);
  const latestIsError = latestAssistantMessage?.uiState === "error";
  const latestPanelState: ChatUiState = latestGenerationLimited
    ? "generation-limited"
    : latestNoDataFound
      ? "noData"
      : latestIsError
        ? "error"
        : latestHasSources
          ? "source-found"
          : "initial-empty";

  const chatHeader = (
    <div className="rounded-none border-b border-[#D8DCCF] bg-[#FBFBF7]/95 px-4 py-2.5 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="min-w-0 flex items-center space-x-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF]">
            <Bot className="h-4 w-4 text-[#1F7A4D]" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[#111713]">
              Compass Policy Desk
            </h2>
            <p className="hidden text-xs text-[#5F6C62] sm:block">
              정책 답변, 출처, 검토 상태를 한 화면에서 운영자가 확인합니다.
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="대화 히스토리 열기"
                className="flex h-8 items-center space-x-2 rounded-md px-2 text-[#5F6C62] transition-colors hover:bg-[#EDF7EF] hover:text-[#111713] lg:hidden"
              >
                <History className="w-4 h-4" />
                <span className="hidden text-xs sm:inline">히스토리</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[min(88vw,22rem)] bg-white p-0">
              <SheetTitle className="sr-only">대화 히스토리</SheetTitle>
              <HistoryPanel
                onLoadConversation={(conversation) => {
                  handleLoadConversation(conversation);
                  setHistoryOpen(false);
                }}
                onNewChat={() => {
                  handleNewChat();
                  setHistoryOpen(false);
                }}
                userId={user?.id || "anonymous"}
                className="h-full"
                isCollapsed={false}
                onToggle={() => setHistoryOpen(false)}
                refreshTrigger={historyRefreshTrigger}
              />
            </SheetContent>
          </Sheet>
          <Badge variant="outline" className="rounded-md border-[#D6D8CD] bg-white px-2 py-1 text-[11px] text-[#5F6C62] sm:hidden">
            정책 데스크
          </Badge>
          <Badge variant="outline" className="hidden rounded-md border-[#C6D9CB] bg-[#EDF7EF] px-2 py-1 text-[11px] text-[#1F7A4D] sm:inline-flex">
            출처 검토
          </Badge>
          <Badge variant="outline" className="hidden rounded-md border-[#E9D59B] bg-[#FFF8E6] px-2 py-1 text-[11px] text-[#8A6418] md:inline-flex">
            정책 근거 우선
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleRightPanel}
            className="hidden h-8 items-center space-x-2 rounded-md px-3 text-[#5F6C62] transition-colors hover:bg-[#EDF7EF] hover:text-[#111713] lg:flex"
          >
            {isRightPanelCollapsed ? (
              <PanelRight className="w-4 h-4" />
            ) : (
              <PanelLeft className="w-4 h-4" />
            )}
            <span className="text-xs">
              {isRightPanelCollapsed ? "패널 펼치기" : "패널 접기"}
            </span>
          </Button>
          
          <Separator orientation="vertical" className="hidden h-6 bg-[#D8DCCF] lg:block" />
          
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewChat}
            className="flex h-8 items-center space-x-2 rounded-md px-3 text-[#5F6C62] transition-colors hover:bg-[#EDF7EF] hover:text-[#111713]"
            aria-label="새 대화"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden text-xs sm:inline">새 대화</span>
          </Button>
        </div>
      </div>
    </div>
  );

  // 로딩 중이거나 로그인하지 않은 경우
  if (loading) {
    return (
      <MainLayout>
        <div className="mt-32 flex h-[calc(100dvh-8rem)] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-[#1F7A4D]"></div>
            <p className="text-[#667066]">로그인 상태를 확인하는 중...</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!user) {
    return (
      <MainLayout>
        <div className="mt-32 flex h-[calc(100dvh-8rem)] items-center justify-center">
          <div className="text-center">
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              <p className="font-bold">로그인이 필요합니다</p>
              <p className="text-sm">채팅 기능을 사용하려면 먼저 로그인해주세요.</p>
            </div>
            <p className="text-[#667066]">잠시 후 메인 페이지로 이동합니다...</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout chatHeader={chatHeader}>
      <div className="mt-32 flex h-[calc(100dvh-8rem)] w-full overflow-hidden bg-[#F4F5F0]">
        {/* 1번 패널: 대화 히스토리 */}
        {!isLeftPanelCollapsed && (
          <div className="hidden h-full w-72 border-r border-[#D8DCCF] bg-white lg:block">
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
        
        {/* 접힌 상태의 좌측 패널 */}
        {isLeftPanelCollapsed && (
          <div className="hidden h-full w-12 border-r border-[#D8DCCF] bg-white lg:block">
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

        {/* 2번 패널: 채팅 영역 */}
        <motion.div 
          className="flex h-full min-w-0 flex-col bg-[#F4F5F0] lg:border-r lg:border-[#D8DCCF]"
          animate={{ 
            width: isMobileLayout || isRightPanelCollapsed ? '100%' : `${leftPanelWidth}%`,
            transition: isDragging ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }
          }}
        >
          <div className="h-3"></div>

          <div className="custom-scrollbar flex-1 min-w-0 space-y-3 overflow-y-auto bg-[#F4F5F0] p-2 sm:space-y-4 sm:p-4">
            {messages.map((message) => (
              <ChatBubble
                key={message.id}
                type={message.type}
                content={message.content}
                timestamp={message.timestamp}
                sources={[]}
                feedback={message.feedback}
                onFeedback={(helpful) => handleFeedback(message.id, helpful)}
                noDataFound={message.noDataFound}
                showContactOption={false}
                confidence={message.confidence}
                processingTime={message.processingTime}
                model={message.uiState === "generation-limited" ? message.model : undefined}
              />
            ))}
            
            {isLoading && (
              <div className="flex justify-start">
                <div className="max-w-3xl">
                  <div className="rounded-lg border border-[#D8DCCF] bg-[#FBFBF7] px-4 py-3 shadow-sm">
                    <div className="flex items-start space-x-3">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF]">
                        <Bot className="h-4 w-4 text-[#1F7A4D]" />
                      </div>
                      <div className="flex-1">
                        <div className="mb-2 text-sm font-medium text-[#111713]">Compass가 정책 데스크 검토를 준비하고 있습니다</div>
                        <div className="flex flex-wrap gap-2 text-xs text-[#5F6C62]">
                          <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1">질문 범위 확인</span>
                          <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1">색인 검색</span>
                          <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1">근거 대조</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {messages.length > 1 && (
              <div className="min-w-0 px-1 pb-2 lg:hidden">
                <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6D756C]">
                  <span>근거 검토 보드</span>
                  <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1 text-[#34423A]">
                    {latestSources.length}개 출처
                  </span>
                </div>
                <SourceStatePanel
                  state={latestPanelState}
                  userQuestion={latestUserMessage?.content}
                  sources={latestSources}
                  showContactOption={latestAssistantMessage?.showContactOption}
                  onContact={() => handleContactRequest(latestUserMessage?.content || "")}
                  onRetry={handleRetry}
                  onPromptSelect={handleQuickQuestionClick}
                  compact
                />
              </div>
            )}
            
          </div>

          <div className="border-t border-[#D8DCCF] bg-[#FBFBF7] p-2 sm:p-3">
            <div className="mx-auto w-full max-w-4xl min-w-0">
              <div className="flex min-w-0 space-x-2 sm:space-x-3">
                <div className="relative min-w-0 flex-1">
                  <Textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="예: Meta 금융 광고 소재 심사 기준과 필요한 고지 문구를 확인해줘"
                    className="max-h-[100px] min-h-[40px] resize-none border-[#D4D8CE] bg-white pr-10 text-sm text-[#111713] placeholder-[#8B9388] focus:border-[#1F7A4D] focus:ring-[#E7F4EA] sm:max-h-[120px] sm:min-h-[44px] sm:pr-12 sm:text-base"
                    style={{ borderRadius: '8px' }}
                    disabled={isLoading}
                    rows={1}
                  />
                  <Button
                    size="sm"
                    onClick={handleSendMessage}
                    disabled={!inputValue.trim() || isLoading}
                    className="absolute bottom-1 right-1 h-7 w-7 rounded-md bg-[#111713] p-0 text-white hover:bg-[#243028] sm:bottom-2 sm:right-2 sm:h-8 sm:w-8"
                  >
                    <Send className="w-3 h-3 sm:w-4 sm:h-4" />
                  </Button>
                </div>
              </div>
              
              <div className="mt-2 flex items-center justify-between text-xs text-[#6D756C] sm:mt-3">
                <p className="hidden sm:block">플랫폼, 정책 항목, 소재 표현을 함께 쓰면 인용 가능한 근거를 더 좁혀 볼 수 있습니다.</p>
                <p className="sm:hidden">답변 아래 근거 보드 표시</p>
                {error && (
                  <div className="flex items-center space-x-1 text-[#D93025]">
                    <AlertCircle className="w-3 h-3" />
                    <span className="hidden sm:inline">연결 오류</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {!isRightPanelCollapsed && (
          <div 
            className="hidden w-1 cursor-col-resize bg-[#D8DCCF] transition-colors duration-200 hover:bg-[#9AB9A3] lg:block"
            onMouseDown={handleResize}
            style={{ cursor: 'col-resize' }}
          />
        )}

        {/* 3번 패널: 관련 자료 표시 */}
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
              className="hidden h-full flex-col overflow-hidden bg-white lg:flex"
            >
            <div className="border-b border-[#D8DCCF] bg-[#FBFBF7] p-4">
              <div className="flex items-center space-x-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF]">
                  <BookOpen className="h-5 w-5 text-[#1F7A4D]" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[#111713]">정책 근거 보드</h3>
                  <p className="text-sm text-[#5F6C62]">답변에 연결된 출처, 인용 후보, 운영 검토 포인트</p>
                </div>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-[#F4F5F0] p-4">
              {/* 질문이 있을 때만 관련 자료와 빠른 질문 표시 */}
              {messages.length > 1 ? (
                <>
                  <SourceStatePanel
                    state={latestPanelState}
                    userQuestion={latestUserMessage?.content}
                    sources={latestSources}
                    showContactOption={latestAssistantMessage?.showContactOption}
                    onContact={() => handleContactRequest(latestUserMessage?.content || "")}
                    onRetry={handleRetry}
                    onPromptSelect={handleQuickQuestionClick}
                  />
                  
                  {/* 빠른 질문 컴포넌트 - 하단 배치 */}
                  <QuickQuestions 
                    onQuestionClick={handleQuickQuestionClick} 
                    currentQuestion={messages[messages.length - 2]?.content}
                  />
                </>
              ) : (
                <SourceStatePanel state="initial-empty" sources={[]} />
              )}
            </div>
            </motion.div>
          )}
        </AnimatePresence>
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
