"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useEffect, useCallback, Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Send, Bot, User, ThumbsUp, ThumbsDown, History, FileText,
  MessageSquare, Clock, Settings, PanelRight, PanelLeft,
  ChevronRight, ChevronLeft, BookOpen, X, RefreshCw, Trash2,
  AlertTriangle, HelpCircle, Copy, Check
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@/lib/utils/logger";
import HistoryPanel from "@/components/chat/HistoryPanel";
import RelatedResources from "@/components/chat/RelatedResources";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { UserProfileDropdown } from "@/components/layouts/UserProfileDropdown";
import { AuthModal } from "@/components/layouts/AuthModal";
import Link from "next/link";
import Image from "next/image";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: string;
  sources?: Array<{
    id: string;
    title: string;
    url?: string;
    updatedAt?: string;
    excerpt?: string;
  }>;
  feedback?: {
    helpful: boolean | null;
    count: number;
  };
  noDataFound?: boolean;
  showContactOption?: boolean;
  relatedQuestions?: string[];
}

interface Theme {
  name: string;
  bgMain: string;
  bgSidebar: string;
  bgInput: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
}

const themes: Record<string, Theme> = {
  dark: {
    name: "Dark",
    bgMain: "#0B0F17", // gemini_theme 메인 배경
    bgSidebar: "#0B0F17", // gemini_theme 메인 배경
    bgInput: "#131823", // gemini_theme 카드 배경
    border: "rgba(255, 255, 255, 0.1)", // gemini_theme 보더 스타일
    textPrimary: "#ffffff",
    textSecondary: "rgba(255, 255, 255, 0.6)", // gemini_theme 텍스트 스타일
    accent: "#4285f4",
  },
  light: {
    name: "Light",
    bgMain: "#ffffff",
    bgSidebar: "#f8f9fa",
    bgInput: "#ffffff",
    border: "#dadce0",
    textPrimary: "#202124",
    textSecondary: "#5f6368",
    accent: "#1a73e8",
  },
  blue: {
    name: "Blue",
    bgMain: "#1e3a5f",
    bgSidebar: "#152238",
    bgInput: "#152238",
    border: "#2d4a6b",
    textPrimary: "#ffffff",
    textSecondary: "#b3c5d9",
    accent: "#4285f4",
  },
  purple: {
    name: "Purple",
    bgMain: "#3d2a5f",
    bgSidebar: "#2a1d42",
    bgInput: "#2a1d42",
    border: "#4d3a6f",
    textPrimary: "#ffffff",
    textSecondary: "#c4b3d9",
    accent: "#9c27b0",
  },
  green: {
    name: "Green",
    bgMain: "#1e5f3d",
    bgSidebar: "#143828",
    bgInput: "#143828",
    border: "#2d6b4a",
    textPrimary: "#ffffff",
    textSecondary: "#b3d9c5",
    accent: "#4caf50",
  },
  red: {
    name: "Red",
    bgMain: "#5f1e1e",
    bgSidebar: "#381414",
    bgInput: "#381414",
    border: "#6b2d2d",
    textPrimary: "#ffffff",
    textSecondary: "#d9b3b3",
    accent: "#f44336",
  },
};

// Gmail 스타일 레이아웃
function GmailStyleLayout() {
  const { user, loading, signOut } = useAuth();
  const { toast } = useToast();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<"signin" | "signup">("signin");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMenu, setSelectedMenu] = useState("history");
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [savedMessageIds, setSavedMessageIds] = useState<Set<string>>(new Set());
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);
  const [vendorFilter, setVendorFilter] = useState<string[] | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);


  // 테마 및 설정 상태
  const [currentTheme, setCurrentTheme] = useState<string>("dark");
  const [density, setDensity] = useState<"default" | "comfortable" | "compact">("default");
  const [inboxType, setInboxType] = useState<"default" | "important" | "unread">("default");

  // 패널 폭 및 드래그 상태
  const [rightPanelWidth, setRightPanelWidth] = useState(360);
  const [isDragging, setIsDragging] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isMobileLeftOpen, setIsMobileLeftOpen] = useState(false);
  const [isMobileRightOpen, setIsMobileRightOpen] = useState(false);
  const [hasProcessedInitialQuestion, setHasProcessedInitialQuestion] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchParams = useSearchParams();

  const hasPendingAssistantMessage = useMemo(
    () => messages.some(msg => msg.type === "assistant" && (!msg.content || msg.content.trim().length === 0)),
    [messages]
  );

  const DEFAULT_PANEL_BG = "#0B0F17"; // gemini_theme 메인 배경
  const MAIN_PANEL_BG = "#131823"; // gemini_theme 카드 배경
  const RIGHT_PANEL_BG = "#131823"; // gemini_theme와 통일

  // 테마 적용
  useEffect(() => {
    const savedTheme = localStorage.getItem('gmail-chat-theme') || 'dark';
    setCurrentTheme(savedTheme);
  }, []);

  useEffect(() => {
    const savedDensity = localStorage.getItem('gmail-chat-density') as "default" | "comfortable" | "compact" || 'default';
    setDensity(savedDensity);
  }, []);

  useEffect(() => {
    const savedInboxType = localStorage.getItem('gmail-chat-inbox-type') as "default" | "important" | "unread" || 'default';
    setInboxType(savedInboxType);
  }, []);



  // 우측 패널 폭 복원
  useEffect(() => {
    const savedWidth = localStorage.getItem('gmail-chat-right-panel-width');
    if (savedWidth) {
      setRightPanelWidth(parseInt(savedWidth, 10));
    }
  }, []);

  // 우측 패널 폭 저장
  useEffect(() => {
    if (rightPanelWidth && !isDragging) {
      localStorage.setItem('gmail-chat-right-panel-width', rightPanelWidth.toString());
    }
  }, [rightPanelWidth, isDragging]);

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

  // 인증 모달 이벤트 리스너
  useEffect(() => {
    const handleOpenAuthModal = (event: Event) => {
      try {
        if (event && typeof event === 'object' && 'detail' in event) {
          const customEvent = event as CustomEvent;
          if (customEvent.detail && typeof customEvent.detail === 'object' && 'mode' in customEvent.detail) {
            setAuthModalMode(customEvent.detail.mode);
            setAuthModalOpen(true);
          }
        }
      } catch (error) {
        console.error('인증 모달 이벤트 처리 중 오류:', error);
      }
    };

    window.addEventListener('openAuthModal', handleOpenAuthModal);

    return () => {
      window.removeEventListener('openAuthModal', handleOpenAuthModal);
    };
  }, []);

  // 모바일 감지
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
      setRightPanelOpen(false);
    } else {
      setIsMobileLeftOpen(false);
      setIsMobileRightOpen(false);
    }
  }, [isMobile]);

  // 로그인 강제 리다이렉트
  useEffect(() => {
    if (!loading && !user) {
      window.location.href = '/';
    }
  }, [loading, user]);

  // URL 파라미터 초기 질문 처리
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
  }, [searchParams, isInitialized, user, hasProcessedInitialQuestion]);

  // 메시지 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 스트리밍 응답 처리
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

    // aiResponse는 이미 handleSendMessage에서 추가되었으므로 여기서는 추가하지 않음
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
            setSavedMessageIds(prev => new Set([...prev, userMessage.id, aiResponseId]));
            setHistoryRefreshTrigger(prev => prev + 1);
            logger.log('대화가 자동으로 저장되었습니다.');
          }
        }
      } catch (saveError) {
        logger.error('대화 자동 저장 오류:', saveError);
      }
    }

    return fullContent;
  };

  // 초기 질문으로 메시지 전송
  const handleSendMessageWithQuestion = useCallback(async (question: string) => {
    if (!question.trim() || isLoading) {
      return;
    }

    if (!user) {
      return;
    }

    const currentInput = question.trim();
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

    const aiResponseId = `ai_${Date.now()}`;
    const aiResponse: Message = {
      id: aiResponseId,
      type: "assistant",
      content: "",
      timestamp: "생성 중...",
      sources: [],
    };

    setMessages(prev => [...prev, userMessage, aiResponse]);

    try {
      await processStreamingResponse(currentInput, userMessage, aiResponseId, aiResponse, [...messages, userMessage]);
    } catch (err) {
      logger.error('메시지 전송 오류:', err);
      setError(err instanceof Error ? err.message : '메시지를 전송하는 중 오류가 발생했습니다.');
      setMessages(prev => prev.filter(msg => msg.id !== aiResponseId));
    } finally {
      setIsLoading(false);
    }
  }, [user, isLoading, messages, vendorFilter, processStreamingResponse]);

  // 메시지 전송
  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) {
      return;
    }

    if (!user) {
      toast({
        title: "로그인 필요",
        description: "채팅 기능을 사용하려면 먼저 로그인해주세요.",
        variant: "destructive",
        duration: 3000,
      });
      return;
    }

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

    // AI 응답 플레이스홀더를 상태에 추가 (이 부분이 빠져있었음)
    setMessages(prev => [...prev, aiResponse]);

    try {
      await processStreamingResponse(currentInput, userMessage, aiResponseId, aiResponse, [...messages, userMessage]);
    } catch (error) {
      logger.error('❌ 채팅 API 오류:', error);

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
    }
  }, [messages, vendorFilter, user, isLoading, inputValue, savedMessageIds, toast, processStreamingResponse]);

  // 자동 저장을 위한 ref
  const messagesRef = useRef(messages);
  const savedMessageIdsRef = useRef(savedMessageIds);
  const userRef = useRef(user);
  const isSavingRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
    savedMessageIdsRef.current = savedMessageIds;
    userRef.current = user;
  });

  // 세션 종료 시 자동 저장
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

  const handleContactRequest = useCallback(async (question: string, aiResponse?: string) => {
    const lastUserMessage = messages.filter(msg => msg.type === 'user').pop();
    const actualQuestion = lastUserMessage?.content || question;
    const lastAiMessage = messages.filter(msg => msg.type === 'assistant').pop();
    const actualAiResponse = aiResponse || lastAiMessage?.content || '';
    const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || '사용자';
    const userEmail = user?.email || '';

    setIsSendingEmail(true);

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
        logger.log('📧 메일 링크:', data.emailLink);
        try {
          window.open(data.emailLink, '_blank');
        } catch (error) {
          logger.error('❌ 메일 클라이언트 열기 실패:', error);
          window.location.href = data.emailLink;
        }

        const successMessage: Message = {
          id: `success-${Date.now()}`,
          type: "assistant",
          content: "✅ 페이스북 담당팀에 문의사항이 메일로 정상 발송되었습니다.\n\n📧 **발송 정보:**\n- 수신자: fb@nasmedia.co.kr\n- 문의 내용: " + actualQuestion.substring(0, 50) + (actualQuestion.length > 50 ? "..." : "") + "\n- 발송 시간: " + new Date().toLocaleString('ko-KR') + "\n\n💡 **메일 클라이언트가 열리지 않는다면:**\n직접 fb@nasmedia.co.kr로 메일을 보내주세요.\n\n담당팀에서 검토 후 답변을 드릴 예정입니다.",
          timestamp: new Date().toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit'
          }),
        };

        setMessages(prev => prev.map(msg =>
          msg.id === sendingMessage.id ? successMessage : msg
        ));
      }
    } catch (error) {
      logger.error("Error sending contact email:", error);

      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        type: "assistant",
        content: "❌ 메일 발송 중 오류가 발생했습니다.\n\n**오류 내용:**\n" + (error instanceof Error ? error.message : "알 수 없는 오류") + "\n\n잠시 후 다시 시도해주시거나, 직접 fb@nasmedia.co.kr로 문의해주세요.",
        timestamp: new Date().toLocaleTimeString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit'
        }),
      };

      setMessages(prev => prev.map(msg =>
        msg.id === sendingMessage.id ? errorMessage : msg
      ));
    } finally {
      setIsSendingEmail(false);
    }
  }, [messages, user]);

  // 새 대화 시작
  const handleNewChat = useCallback(() => {
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
    setInputValue("");
    setHistoryRefreshTrigger(prev => prev + 1);
    setSelectedMenu("history");
  }, []);

  // 빠른 질문 클릭 처리
  const handleQuickQuestionClick = useCallback((question: string) => {
    if (!question.trim() || isLoading) {
      return;
    }
    setInputValue(question);
    setTimeout(() => {
      handleSendMessageWithQuestion(question);
    }, 100);
  }, [isLoading, handleSendMessageWithQuestion]);

  // 대화 로드
  const handleLoadConversation = useCallback(async (conversation: any) => {
    setIsLoading(true);

    const fetchFeedback = async (conversationId: string) => {
      if (!user?.id) return { helpful: null, count: 0 };

      try {
        const response = await fetch(`/api/feedback?userId=${encodeURIComponent(user.id)}&conversationId=${encodeURIComponent(conversationId)}`);
        if (response.ok) {
          const data = await response.json();
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
      setConversationId(conversation.conversationId);
      setIsInitialized(true);
    } catch (error) {
      logger.error('대화 로드 오류:', error);
      setError('대화를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
      setInputValue("");
    }
  }, [user]);

  // 복사 기능
  const handleCopyMessage = useCallback(async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      toast({
        title: "복사 완료",
        description: "답변이 클립보드에 복사되었습니다.",
        duration: 2000,
      });
      setTimeout(() => {
        setCopiedMessageId(null);
      }, 2000);
    } catch (error) {
      logger.error('복사 오류:', error);
      toast({
        title: "복사 실패",
        description: "클립보드에 복사하는 중 오류가 발생했습니다.",
        variant: "destructive",
        duration: 3000,
      });
    }
  }, [toast]);

  // 피드백 처리
  const handleFeedback = useCallback(async (messageId: string, helpful: boolean) => {
    if (!user) {
      toast({
        title: "로그인 필요",
        description: "피드백을 남기려면 먼저 로그인해주세요.",
        variant: "destructive",
        duration: 3000,
      });
      return;
    }

    const message = messages.find(msg => msg.id === messageId);
    if (message?.feedback?.helpful === helpful) {
      return;
    }

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

    try {
      const messageSources = message?.sources || [];

      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          conversationId: conversationId || `conv_${Date.now()}`,
          messageId: messageId,
          helpful: helpful,
          sources: messageSources
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
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? { ...msg, feedback: { helpful: null, count: 0 } }
          : msg
      ));
    }
  }, [user, messages, conversationId, toast]);

  // 테마 변경
  const handleThemeChange = (themeName: string) => {
    setCurrentTheme(themeName);
    localStorage.setItem('gmail-chat-theme', themeName);
  };

  // Density 변경
  const handleDensityChange = (newDensity: "default" | "comfortable" | "compact") => {
    setDensity(newDensity);
    localStorage.setItem('gmail-chat-density', newDensity);
  };

  // Inbox type 변경
  const handleInboxTypeChange = (newType: "default" | "important" | "unread") => {
    setInboxType(newType);
    localStorage.setItem('gmail-chat-inbox-type', newType);
  };

  // 좌측 패널 토글
  const toggleLeftPanel = useCallback(() => {
    setIsLeftPanelCollapsed(prev => !prev);
  }, []);

  // 우측 패널 토글
  const toggleRightPanel = useCallback(() => {
    setRightPanelOpen(prev => !prev);
  }, []);

  // 우측 패널 드래그 핸들러
  const handleRightPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);

    const startX = e.clientX;
    const startWidth = rightPanelWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = startX - e.clientX; // 우측 패널은 왼쪽으로 드래그하면 넓어짐
      const newWidth = Math.min(Math.max(startWidth + deltaX, 280), 600);
      setRightPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [rightPanelWidth]);

  // 정렬된 메시지 (Inbox type에 따라)
  const sortedMessages = useCallback(() => {
    if (inboxType === "unread") {
      return [...messages].reverse();
    }
    return messages;
  }, [messages, inboxType]);

  const theme = themes[currentTheme];
  const messageSpacing = density === "compact" ? "space-y-2" : density === "comfortable" ? "space-y-6" : "space-y-4";
  const sidebarTransition = { duration: 0.4, ease: [0.25, 0.8, 0.25, 1] };
  const sidebarContentVariants = {
    hidden: { opacity: 0, x: -16, scale: 0.98 },
    visible: { opacity: 1, x: 0, scale: 1, transition: { duration: 0.25, ease: [0.25, 0.8, 0.25, 1] } },
  };

  // 로딩 중
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: theme.bgMain }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: theme.accent }}></div>
          <p style={{ color: theme.textSecondary }}>로그인 상태를 확인하는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden relative" style={{ backgroundColor: theme.bgMain, color: theme.textPrimary }}>
      {/* Background Effects - gemini_theme 스타일 */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-[20%] right-[20%] w-[20%] h-[20%] bg-cyan-500/10 rounded-full blur-[80px]" />
      </div>

      {/* 좌측 사이드바 */}
      <motion.aside
        initial={false}
        animate={{ width: isLeftPanelCollapsed ? 64 : 256 }}
        transition={sidebarTransition}
        className="border-r relative flex flex-col overflow-hidden"
        style={{ backgroundColor: DEFAULT_PANEL_BG, borderColor: 'rgba(255, 255, 255, 0.1)' }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isLeftPanelCollapsed ? (
            <motion.div
              key="collapsed"
              className="flex-1"
              initial="hidden"
              animate="visible"
              exit="hidden"
              variants={sidebarContentVariants}
            >
              <div className="absolute top-2 right-2 z-10">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleLeftPanel}
                  className="h-8 w-8 p-0"
                  style={{ color: theme.textSecondary }}
                  title="좌측 패널 펼치기"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto py-2 pt-12">
                <div className="flex flex-col items-center space-y-2">
                  <button
                    onClick={() => {
                      setSelectedMenu("inbox");
                      handleNewChat();
                    }}
                    className={`w-12 h-12 flex items-center justify-center rounded-lg border transition-all ${selectedMenu === "inbox"
                      ? "bg-blue-500/20 text-blue-100 border-blue-400/40 shadow-[0_0_12px_rgba(66,133,244,0.35)]"
                      : "text-gray-400 border-transparent hover:bg-gray-800"
                      }`}
                    title="새 대화하기"
                    aria-current={selectedMenu === "inbox" ? "page" : undefined}
                  >
                    <MessageSquare className="w-5 h-5" />
                  </button>

                  <div className="w-8 h-px my-2" style={{ backgroundColor: theme.border }} />

                  <button
                    onClick={() => setSelectedMenu("history")}
                    className={`w-12 h-12 flex items-center justify-center rounded-lg border transition-all ${selectedMenu === "history"
                      ? "bg-blue-500/20 text-blue-100 border-blue-400/40 shadow-[0_0_12px_rgba(66,133,244,0.35)]"
                      : "text-gray-400 border-transparent hover:bg-gray-800"
                      }`}
                    title="히스토리"
                    aria-current={selectedMenu === "history" ? "page" : undefined}
                  >
                    <History className="w-5 h-5" />
                  </button>

                  <button
                    onClick={() => setSelectedMenu("saved")}
                    className={`w-12 h-12 flex items-center justify-center rounded-lg border transition-all ${selectedMenu === "saved"
                      ? "bg-blue-500/20 text-blue-100 border-blue-400/40 shadow-[0_0_12px_rgba(66,133,244,0.35)]"
                      : "text-gray-400 border-transparent hover:bg-gray-800"
                      }`}
                    title="저장된 답변"
                    aria-current={selectedMenu === "saved" ? "page" : undefined}
                  >
                    <BookOpen className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="expanded"
              className="flex flex-col h-full"
              initial="hidden"
              animate="visible"
              exit="hidden"
              variants={sidebarContentVariants}
            >
              <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide" style={{ color: theme.textSecondary }}>
                    대화 목록
                  </p>
                  <p className="text-sm font-semibold" style={{ color: theme.textPrimary }}>
                    최근 문의 내역
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleLeftPanel}
                  className="h-9 w-9"
                  style={{ color: theme.textSecondary }}
                  title="좌측 패널 접기"
                >
                  <PanelLeft className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto py-2" style={{ minHeight: 0 }}>
                <div className="px-2 space-y-1">
                  <button
                    onClick={() => {
                      setSelectedMenu("inbox");
                      handleNewChat();
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-r-full text-sm font-medium transition-colors hover:bg-gray-800"
                    style={{ color: theme.textPrimary }}
                  >
                    <div className="flex items-center gap-3">
                      <MessageSquare className="w-5 h-5" />
                      <span>새 대화하기</span>
                    </div>
                  </button>

                  <Separator className="my-2" style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }} />

                  <button
                    onClick={() => setSelectedMenu("history")}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-r-full text-sm font-medium transition-colors ${selectedMenu === "history"
                      ? "bg-blue-50 text-blue-600"
                      : "hover:bg-gray-800"
                      }`}
                    style={selectedMenu !== "history" ? { color: theme.textSecondary } : {}}
                  >
                    <History className="w-5 h-5" />
                    <span>히스토리</span>
                  </button>

                  <button
                    onClick={() => setSelectedMenu("saved")}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-r-full text-sm font-medium transition-colors ${selectedMenu === "saved"
                      ? "bg-blue-50 text-blue-600"
                      : "hover:bg-gray-800"
                      }`}
                    style={selectedMenu !== "saved" ? { color: theme.textSecondary } : {}}
                  >
                    <BookOpen className="w-5 h-5" />
                    <span>저장된 답변</span>
                  </button>
                </div>

                {selectedMenu === "history" && user && (
                  <div
                    className="mt-4 flex flex-col overflow-hidden"
                    style={{ backgroundColor: DEFAULT_PANEL_BG, minHeight: 0 }}
                  >
                    <div className="px-4 pb-2">
                      <p className="text-sm font-medium" style={{ color: theme.textPrimary }}>
                        대화 히스토리
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: theme.textSecondary }}>
                        최근 대화 30개가 표시됩니다
                      </p>
                    </div>
                    <div
                      className="flex-1 overflow-hidden rounded-lg border"
                      style={{
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)',
                        minHeight: 0
                      }}
                    >
                      <HistoryPanel
                        onLoadConversation={handleLoadConversation}
                        onNewChat={handleNewChat}
                        userId={user.id}
                        isCollapsed={false}
                        refreshTrigger={historyRefreshTrigger}
                        filterMode="history"
                        panelTitle="대화 히스토리"
                        panelDescription="최근 대화 기록"
                        onFavoritesUpdated={() => setHistoryRefreshTrigger(prev => prev + 1)}
                        emptyStateMessage={{
                          title: "최근 대화가 없습니다",
                          description: "새 대화를 시작하거나 저장한 답변을 확인해보세요.",
                        }}
                        theme={{
                          bgSidebar: theme.bgSidebar,
                          bgMain: theme.bgMain,
                          border: theme.border,
                          textPrimary: theme.textPrimary,
                          textSecondary: theme.textSecondary,
                          accent: theme.accent,
                        }}
                      />
                    </div>
                  </div>
                )}
                {selectedMenu === "saved" && user && (
                  <div
                    className="mt-4 flex flex-col overflow-hidden"
                    style={{ backgroundColor: DEFAULT_PANEL_BG, minHeight: 0 }}
                  >
                    <div className="px-4 pb-2">
                      <p className="text-sm font-medium" style={{ color: theme.textPrimary }}>
                        저장된 답변
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: theme.textSecondary }}>
                        별표한 답변이 여기에 모여요
                      </p>
                    </div>
                    <div
                      className="flex-1 overflow-hidden rounded-lg border"
                      style={{
                        borderColor: `${theme.border}80`,
                        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)',
                        minHeight: 0,
                      }}
                    >
                      <HistoryPanel
                        onLoadConversation={handleLoadConversation}
                        onNewChat={handleNewChat}
                        userId={user.id}
                        isCollapsed={false}
                        refreshTrigger={historyRefreshTrigger}
                        filterMode="saved"
                        panelTitle="저장된 답변"
                        panelDescription="즐겨찾기한 답변"
                        onFavoritesUpdated={() => setHistoryRefreshTrigger(prev => prev + 1)}
                        emptyStateMessage={{
                          title: "저장된 답변이 없습니다",
                          description: "히스토리에서 별 아이콘을 눌러 답변을 저장할 수 있습니다.",
                        }}
                        theme={{
                          bgSidebar: theme.bgSidebar,
                          bgMain: theme.bgMain,
                          border: theme.border,
                          textPrimary: theme.textPrimary,
                          textSecondary: theme.textSecondary,
                          accent: theme.accent,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.aside>

      {/* 중간 영역 - 메인 콘텐츠 */}
      <div
        className="flex-1 flex flex-col rounded-lg overflow-hidden shadow-sm relative"
        style={{
          margin: '12px',
          marginRight: rightPanelOpen ? '6px' : '12px',
          backgroundColor: MAIN_PANEL_BG,
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        {/* 그라데이션 오버레이 - gemini_theme 스타일 */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-transparent to-purple-900/20 pointer-events-none rounded-lg" />

        {/* 상단 바 - 실제 메인 페이지 헤더 스타일 */}
        <div className="h-16 border-b flex items-center justify-between px-4 relative z-10" style={{ backgroundColor: 'rgba(19, 24, 35, 0.8)', backdropFilter: 'blur(12px)', borderColor: 'rgba(255, 255, 255, 0.1)' }}>
          <div className="flex items-center gap-4">
            {/* AdMate 로고 */}
            <Link href="/" className="block">
              <motion.div
                className="cursor-pointer"
                whileHover={{
                  scale: 1.05,
                  transition: { duration: 0.3 }
                }}
                whileTap={{ scale: 0.95 }}
              >
                <motion.div
                  whileHover={{
                    filter: "brightness(1.1) drop-shadow(0 4px 8px rgba(255, 107, 53, 0.3))",
                    transition: { duration: 0.2 }
                  }}
                >
                  <Image
                    src="/admate-logo.png"
                    alt="AdMate - AI 기반 멀티 벤더 광고 정책 챗봇"
                    width={200}
                    height={96}
                    priority
                    className="h-20 w-auto"
                    style={{ height: '80px', width: 'auto' }}
                  />
                </motion.div>
              </motion.div>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            {/* 사용자 프로필 */}
            <UserProfileDropdown user={user} onSignOut={async () => {
              try {
                await signOut();
              } catch (error) {
                console.error('로그아웃 오류:', error);
              }
            }} />
          </div>
        </div>

        {/* 상단 안내 텍스트 */}
        <div className="px-6 py-4 border-b relative z-10" style={{ backgroundColor: 'transparent', borderColor: 'rgba(255, 255, 255, 0.1)' }}>
          <div className="max-w-4xl mx-auto">
            <h2 className="text-lg font-semibold mb-2" style={{ color: theme.textPrimary }}>
              멀티 광고 플랫폼 AI Agent
            </h2>
            <p className="text-sm" style={{ color: theme.textSecondary }}>
              챗봇 답변에 대한 만족도를 평가해주세요. 품질개선에 큰 도움이 됩니다.
            </p>
          </div>
        </div>

        {/* 메시지 리스트 영역 */}
        <div className="flex-1 overflow-y-auto relative z-10" style={{ minHeight: 0 }}>
          <div className={`max-w-4xl mx-auto px-6 py-4 ${messageSpacing}`}>
            {sortedMessages().map((message) => (
              <div
                key={message.id}
                className={`flex gap-4 p-4 rounded-lg hover:bg-opacity-50 transition-colors ${message.type === "user" ? "justify-end" : "justify-start"
                  }`}
                style={{ backgroundColor: 'transparent' }}
              >
                {message.type === "assistant" && (
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #4285f4, #9c27b0)' }}
                  >
                    <Bot className="w-6 h-6 text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-xl px-4 py-3 ${message.type === "user"
                    ? "text-white"
                    : "border"
                    }`}
                  style={message.type === "user"
                    ? { background: 'linear-gradient(135deg, #4285f4, #9c27b0)' }
                    : {
                      backgroundColor: 'rgba(19, 24, 35, 0.6)',
                      borderColor: 'rgba(255, 255, 255, 0.1)',
                      color: theme.textPrimary
                    }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold">
                      {message.type === "user" ? "사용자" : "AI 어시스턴트"}
                    </span>
                    <span className="text-xs" style={{ color: theme.textSecondary }}>{message.timestamp}</span>
                  </div>
                  <div className="text-sm leading-relaxed mb-3">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ children }) => <h1 className="text-xl font-bold text-blue-300 mb-3 mt-4 border-b border-blue-500/30 pb-1">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-lg font-semibold text-blue-200 mb-2 mt-3 border-l-4 border-blue-400 pl-3">{children}</h2>,
                        h3: ({ children }) => (
                          <h3 className="text-sm sm:text-base font-bold text-[#bae6fd] mb-2 mt-4 flex items-center bg-blue-500/10 px-2 py-1 rounded-sm border-l-2 border-blue-400/50">
                            {children}
                          </h3>
                        ),
                        p: ({ children }) => <p className="mb-3 leading-[1.7] text-gray-200 last:mb-0">{children}</p>,
                        strong: ({ children }) => <strong className="font-bold text-blue-300">{children}</strong>,
                        ul: ({ children }) => <ul className="list-disc list-inside space-y-1.5 mb-3 pl-2">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal list-inside space-y-1.5 mb-3 pl-2">{children}</ol>,
                        li: ({ children }) => <li className="mb-0.5">{children}</li>,
                        code: ({ children }) => (
                          <code className="bg-gray-800 text-yellow-200 px-1.5 py-0.5 rounded text-xs font-mono">
                            {children}
                          </code>
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-2 border-blue-400 pl-3 py-1 my-3 bg-blue-900/20 rounded-r-md italic text-blue-100 text-sm">
                            {children}
                          </blockquote>
                        ),
                        a: ({ href, children }) => {
                          if (href?.startsWith('citation:')) {
                            return (
                              <span className="inline-flex items-center text-[#38BDF8] font-bold text-[10px] sm:text-[11px] mx-0.5 opacity-90">
                                ({children})
                              </span>
                            );
                          }
                          return (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                              {children}
                            </a>
                          );
                        },
                      }}
                    >
                      {message.content.replace(/\[출처\s*(\d+)\]/g, '[출처 $1](citation:$1)')}
                    </ReactMarkdown>
                  </div>
                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
                      <p className="text-xs font-semibold mb-2" style={{ color: theme.textSecondary }}>출처</p>
                      <div className="space-y-1">
                        {message.sources.map((source) => (
                          <a
                            key={source.id}
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs hover:underline flex items-center gap-1"
                            style={{ color: theme.accent }}
                          >
                            <FileText className="w-3 h-3" />
                            {source.title}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {message.type === "assistant" && message.showContactOption && (
                    <div
                      className="mt-5 rounded-2xl border relative overflow-hidden shadow-lg"
                      style={{
                        borderColor: `${theme.accent}33`,
                        background: `linear-gradient(135deg, ${theme.accent}15, rgba(255,255,255,0.08))`,
                      }}
                    >
                      <div
                        className="absolute inset-0 opacity-40"
                        style={{
                          background: `radial-gradient(circle at top right, ${theme.accent}66, transparent 60%)`
                        }}
                      />
                      <div className="relative p-4 sm:p-5 flex flex-col gap-4">
                        <div className="flex items-start gap-4">
                          <div
                            className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg"
                            style={{
                              background: `linear-gradient(145deg, ${theme.accent}, ${theme.accent}CC)`
                            }}
                          >
                            <AlertTriangle className="w-6 h-6 text-white" />
                          </div>
                          <div className="flex-1">
                            <p className="text-xs uppercase tracking-widest font-semibold mb-1" style={{ color: theme.textSecondary }}>
                              추가 상담 필요 시
                            </p>
                            <h4 className="text-base font-semibold mb-1" style={{ color: theme.textPrimary }}>
                              벤더 담당팀에게 바로 연결해드릴까요?
                            </h4>
                            <p className="text-sm leading-relaxed" style={{ color: theme.textSecondary }}>
                              보다 구체적인 정책 확인이나 빠른 승인 검토가 필요하면 담당팀이 직접 도와드립니다.
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-2 text-xs" style={{ color: theme.textSecondary }}>
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.accent }} />
                            상담 가능 시간: 평일 09:00 - 18:00
                          </div>
                          <Button
                            className="w-full sm:w-auto px-5 h-11 rounded-xl font-semibold shadow-lg shadow-blue-900/20"
                            style={{
                              background: `linear-gradient(120deg, ${theme.accent}, ${theme.accent}CC)`,
                              color: '#fff',
                            }}
                            onClick={() => handleContactRequest(message.content, message.content)}
                            disabled={isSendingEmail}
                          >
                            <MessageSquare className="w-4 h-4 mr-2" />
                            {isSendingEmail ? "문의 전송 중..." : "담당팀에 문의하기"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {message.type === "assistant" && (
                    <div className="flex gap-2 mt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handleCopyMessage(message.id, message.content)}
                        title="답변 복사"
                        style={{
                          color: copiedMessageId === message.id ? theme.accent : theme.textSecondary
                        }}
                      >
                        {copiedMessageId === message.id ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handleFeedback(message.id, true)}
                        title="도움됨"
                        style={{
                          color: message.feedback?.helpful === true ? theme.accent : theme.textSecondary
                        }}
                      >
                        <ThumbsUp className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handleFeedback(message.id, false)}
                        title="도움 안됨"
                        style={{
                          color: message.feedback?.helpful === false ? theme.accent : theme.textSecondary
                        }}
                      >
                        <ThumbsDown className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
                {message.type === "user" && (
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: theme.border }}
                  >
                    <User className="w-6 h-6" style={{ color: theme.textPrimary }} />
                  </div>
                )}
              </div>
            ))}
            {isLoading && !hasPendingAssistantMessage && (
              <div className="flex gap-4 justify-start">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #4285f4, #9c27b0)' }}
                >
                  <Bot className="w-6 h-6 text-white" />
                </div>
                <div
                  className="rounded-xl px-4 py-3 border"
                  style={{ backgroundColor: 'rgba(19, 24, 35, 0.6)', borderColor: 'rgba(255, 255, 255, 0.1)' }}
                >
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2" style={{ borderColor: theme.accent }}></div>
                    <span className="text-sm" style={{ color: theme.textSecondary }}>답변 생성 중...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 입력 영역 */}
        <div className="border-t px-6 py-4 relative z-10" style={{ backgroundColor: 'rgba(19, 24, 35, 0.8)', backdropFilter: 'blur(12px)', borderColor: 'rgba(255, 255, 255, 0.1)' }}>
          <div className="max-w-4xl mx-auto">
            <div className="flex items-end gap-3">
              <Textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={user ? "메시지를 입력하세요..." : "로그인이 필요합니다..."}
                className="flex-1 min-h-[60px] max-h-[120px] resize-none"
                style={{
                  backgroundColor: 'rgba(19, 24, 35, 0.6)',
                  borderColor: 'rgba(255, 255, 255, 0.1)',
                  color: theme.textPrimary
                }}
                rows={1}
                disabled={isLoading}
              />
              <Button
                className="px-6 h-[60px] rounded-xl"
                onClick={handleSendMessage}
                disabled={isLoading || !inputValue.trim()}
                style={{ background: 'linear-gradient(135deg, #4285f4, #9c27b0)' }}
              >
                <Send className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 우측 패널 - Quick Settings */}
      <AnimatePresence>
        {rightPanelOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: rightPanelWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: isDragging ? 0 : 0.2 }}
            className="flex flex-col border-l overflow-hidden relative rounded-lg shadow-sm"
            style={{ backgroundColor: RIGHT_PANEL_BG, borderColor: 'rgba(255, 255, 255, 0.1)', margin: '12px', marginLeft: '6px' }}
          >
            {/* 그라데이션 오버레이 */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-transparent to-purple-900/20 pointer-events-none rounded-lg" />

            {/* 드래그 핸들 */}
            <div
              onMouseDown={handleRightPanelResize}
              className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:w-1.5 transition-all z-10 group"
              style={{
                backgroundColor: isDragging ? theme.accent : 'transparent',
              }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 w-1 group-hover:w-1.5 transition-all"
                style={{
                  backgroundColor: isDragging ? theme.accent : 'rgba(255, 255, 255, 0.2)',
                  opacity: isDragging ? 1 : 0.5
                }}
              />
            </div>

            <div className="p-4 border-b flex items-center justify-between relative z-10" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #4285f4, #9c27b0)' }}
                >
                  <BookOpen className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold" style={{ color: theme.textPrimary }}>관련 자료</h3>
                  <p className="text-xs" style={{ color: theme.textSecondary }}>질문과 관련된 문서와 가이드라인</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleRightPanel}
                style={{ color: '#4b5563' }}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div
              className="flex-1 overflow-y-auto p-4 space-y-6 text-sm leading-relaxed [&_*]:text-sm [&_*]:leading-relaxed relative z-10"
              style={{
                backgroundColor: 'transparent',
                // CSS 변수로 테마 색상 전달
                ['--theme-bg-main' as any]: theme.bgMain,
                ['--theme-bg-sidebar' as any]: theme.bgSidebar,
                ['--theme-border' as any]: 'rgba(255, 255, 255, 0.1)',
                ['--theme-text-primary' as any]: theme.textPrimary,
                ['--theme-text-secondary' as any]: theme.textSecondary,
                ['--theme-accent' as any]: theme.accent,
              }}
            >
              {/* 관련 자료 - 실제 컴포넌트 사용 */}
              {messages.length > 1 && !isLoading ? (
                <div className="space-y-4">
                  <RelatedResources
                    userQuestion={messages[messages.length - 2]?.content}
                    aiResponse={messages[messages.length - 1]?.content}
                    sources={(messages[messages.length - 1]?.sources ?? []).map(source => ({
                      id: source.id,
                      title: source.title,
                      url: source.url,
                      updatedAt: source.updatedAt || new Date().toISOString(),
                      excerpt: source.excerpt || '',
                      sourceType: 'url' as const,
                      documentType: 'document',
                    }))}
                    relatedQuestions={messages[messages.length - 1]?.relatedQuestions}
                    onQuestionClick={(question) => {
                      setInputValue(question);
                      setTimeout(() => {
                        handleSendMessage();
                      }, 100);
                    }}
                  />
                </div>
              ) : messages.length > 1 && isLoading ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ backgroundColor: `${theme.accent}20` }}>
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: theme.accent }}></div>
                      <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: theme.accent, animationDelay: "0.1s" }}></div>
                      <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: theme.accent, animationDelay: "0.2s" }}></div>
                    </div>
                  </div>
                  <h3 className="text-xl font-semibold mb-3" style={{ color: theme.textPrimary }}>AI가 답변을 생성 중입니다</h3>
                  <p className="text-sm max-w-sm leading-relaxed" style={{ color: theme.textSecondary }}>
                    답변이 완료되면 관련 자료와 핵심 요약이 여기에 표시됩니다.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ backgroundColor: `${theme.accent}20` }}>
                    <BookOpen className="w-10 h-10" style={{ color: theme.accent }} />
                  </div>
                  <h3 className="text-xl font-semibold mb-3" style={{ color: theme.textPrimary }}>질문을 시작해보세요</h3>
                  <p className="text-sm max-w-sm leading-relaxed" style={{ color: theme.textSecondary }}>
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

      {!rightPanelOpen && !isMobile && (
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleRightPanel}
          className="fixed right-6 top-24 z-40 shadow-md border bg-black/40 text-white hover:bg-black/60"
        >
          <PanelRight className="w-4 h-4 mr-2" />
          관련 자료 열기
        </Button>
      )}

      {/* 모바일 좌측 패널 Sheet */}
      {isMobile && (
        <Sheet open={isMobileLeftOpen} onOpenChange={setIsMobileLeftOpen}>
          <SheetContent side="left" className="w-[280px] sm:w-[320px] p-0">
            <div className="h-full flex flex-col" style={{ backgroundColor: DEFAULT_PANEL_BG }}>
              <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide" style={{ color: theme.textSecondary }}>
                    대화 목록
                  </p>
                  <p className="text-sm font-semibold" style={{ color: theme.textPrimary }}>
                    최근 문의 내역
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsMobileLeftOpen(false)}
                  className="h-9 w-9"
                  style={{ color: theme.textSecondary }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                {selectedMenu === "history" && user && (
                  <HistoryPanel
                    onLoadConversation={(conv) => {
                      handleLoadConversation(conv);
                      setIsMobileLeftOpen(false);
                    }}
                    onNewChat={() => {
                      handleNewChat();
                      setIsMobileLeftOpen(false);
                    }}
                    userId={user.id}
                    isCollapsed={false}
                    refreshTrigger={historyRefreshTrigger}
                    filterMode="history"
                    onFavoritesUpdated={() => setHistoryRefreshTrigger(prev => prev + 1)}
                    theme={theme}
                  />
                )}
                {selectedMenu === "saved" && user && (
                  <HistoryPanel
                    onLoadConversation={(conv) => {
                      handleLoadConversation(conv);
                      setIsMobileLeftOpen(false);
                    }}
                    onNewChat={() => {
                      handleNewChat();
                      setIsMobileLeftOpen(false);
                    }}
                    userId={user.id}
                    isCollapsed={false}
                    refreshTrigger={historyRefreshTrigger}
                    filterMode="saved"
                    onFavoritesUpdated={() => setHistoryRefreshTrigger(prev => prev + 1)}
                    theme={theme}
                  />
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* 모바일 우측 패널 Sheet */}
      {isMobile && (
        <Sheet open={isMobileRightOpen} onOpenChange={setIsMobileRightOpen}>
          <SheetContent side="right" className="w-[90vw] sm:w-[400px] p-0">
            <div className="h-full flex flex-col" style={{ backgroundColor: RIGHT_PANEL_BG }}>
              <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(255, 255, 255, 0.1)', backgroundColor: RIGHT_PANEL_BG }}>
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>관련 자료</h3>
                  <p className="text-sm" style={{ color: theme.textSecondary }}>질문과 관련된 문서와 가이드라인</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsMobileRightOpen(false)}
                  className="h-9 w-9"
                  style={{ color: theme.textSecondary }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {messages.length > 1 && !isLoading ? (
                  <RelatedResources
                    userQuestion={messages[messages.length - 2]?.content}
                    aiResponse={messages[messages.length - 1]?.content}
                    sources={messages[messages.length - 1]?.sources?.map(s => ({
                      ...s,
                      updatedAt: s.updatedAt || new Date().toISOString(),
                      excerpt: s.excerpt ?? ""
                    })) ?? []}
                    relatedQuestions={messages[messages.length - 1]?.relatedQuestions}
                    onQuestionClick={handleQuickQuestionClick}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ backgroundColor: `${theme.accent}20` }}>
                      <BookOpen className="w-10 h-10" style={{ color: theme.accent }} />
                    </div>
                    <h3 className="text-xl font-semibold mb-3" style={{ color: theme.textPrimary }}>질문을 시작해보세요</h3>
                    <p className="text-sm max-w-sm leading-relaxed" style={{ color: theme.textSecondary }}>
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

      {/* 인증 모달 */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        mode={authModalMode}
      />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-white">Loading...</div>}>
      <GmailStyleLayout />
    </Suspense>
  );
}
