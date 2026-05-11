"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import MainLayout from "@/components/layouts/MainLayout";
import ChatBubble from "@/components/chat/ChatBubble";
import HistoryPanel from "@/components/chat/HistoryPanel";
import QuickQuestions from "@/components/chat/QuickQuestions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Send, Bot, User, Star, ThumbsUp, ThumbsDown, RotateCcw, AlertCircle, CheckCircle, History, FileText, Target, Lightbulb, BookOpen, MessageSquare, Trash2, RefreshCw, PanelLeft, PanelRight, Maximize2, Minimize2, ChevronDown, ChevronUp, ExternalLink, Download, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

type ChatUiState = "initial-empty" | "source-found" | "noData" | "generation-limited" | "error";

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
    sourceType?: "file" | "url" | "document" | string;
  }>;
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

const INITIAL_GREETING = "안녕하세요. Compass에서 광고 정책과 심사 기준을 질문해 주세요.";
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

function SourceStatePanel({
  state,
  sources,
  compact = false,
  userQuestion,
  showContactOption = false,
  onContact,
  onRetry,
}: {
  state: ChatUiState;
  sources: NonNullable<Message["sources"]>;
  compact?: boolean;
  userQuestion?: string;
  showContactOption?: boolean;
  onContact?: () => void;
  onRetry?: () => void;
}) {
  const [cardsVisible, setCardsVisible] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const hasSources = sources.length > 0;
  const isLimited = state === "generation-limited";
  const isNoData = state === "noData";
  const isError = state === "error";
  const isInitial = state === "initial-empty";
  const heading = isLimited ? "생성 답변 제한" : hasSources ? "근거 문서" : "근거 문서 없음";

  const toggleExpanded = (sourceId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  const handleSourceOpen = async (source: NonNullable<Message["sources"]>[number]) => {
    if (!source.url) return;

    if (source.sourceType === "file") {
      try {
        const response = await fetch(source.url);
        if (!response.ok) throw new Error("download failed");
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = source.title || "compass-source";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
      } catch (downloadError) {
        console.error("근거 문서 다운로드 오류:", downloadError);
        alert("파일을 여는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      }
      return;
    }

    window.open(source.url, "_blank", "noopener,noreferrer");
  };

  if (isInitial) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-lg border border-[#E5E5E5] bg-white">
          <BookOpen className="h-8 w-8 text-[#5E6AD2]" />
        </div>
        <h3 className="mb-2 text-base font-semibold text-[#0D0D0D]">질문을 시작해보세요</h3>
        <p className="max-w-sm text-sm leading-relaxed text-[#5E5E5E]">
          질문을 시작하면 근거 문서가 여기에 표시됩니다.
        </p>
      </div>
    );
  }

  if (isNoData || isError) {
    return (
      <Card className="w-full rounded-lg border-[#E5E5E5] bg-white shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-[#0D0D0D]">
            {isError ? <AlertCircle className="h-4 w-4 text-[#D93025]" /> : <Search className="h-4 w-4 text-[#9E5700]" />}
            {heading}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <p className="text-sm leading-6 text-[#5E5E5E]">
            {isError ? ERROR_MESSAGE : NO_DATA_MESSAGE}
          </p>
          {isNoData && (
            <div className="rounded-md border border-[#E5E5E5] bg-[#F7F7F7] p-3 text-xs leading-5 text-[#5E5E5E]">
              플랫폼명, 정책 항목, 소재 유형을 함께 입력하면 더 좁은 범위로 확인할 수 있습니다.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {isError && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="h-9 rounded-md border-[#D8DAF4] bg-[#F4F5FF] px-3 text-xs text-[#4F56B8] hover:bg-[#ECEDF9]"
              >
                다시 시도
              </Button>
            )}
            {isNoData && showContactOption && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onContact}
                className="h-9 rounded-md border-amber-200 bg-amber-50 px-3 text-xs text-amber-800 hover:bg-amber-100"
              >
                문의
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full rounded-lg border-[#E5E5E5] bg-white shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#0D0D0D]">
          <BookOpen className="h-4 w-4 text-[#5E6AD2]" />
          <span>{heading}</span>
          <Badge variant="outline" className="rounded-md border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
            {sources.length}개
          </Badge>
          {isLimited && (
            <Badge variant="outline" className="rounded-md border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
              생성 답변 제한
            </Badge>
          )}
        </CardTitle>
        {userQuestion && !compact && (
          <p className="line-clamp-2 text-xs leading-5 text-[#777777]">
            질문: {userQuestion}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLimited && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            답변 생성은 일시적으로 제한되었지만, 확인된 근거 문서는 아래에서 계속 확인할 수 있습니다.
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCardsVisible((visible) => !visible)}
          className="h-9 rounded-lg border border-[#D8DAF4] bg-white px-3 text-xs font-medium text-[#4F56B8] shadow-sm transition-colors hover:bg-[#F4F5FF] hover:text-[#3F45A0]"
        >
          <FileText className="mr-2 h-4 w-4" />
          근거 문서 {sources.length}개 보기
          {cardsVisible ? <ChevronUp className="ml-2 h-3.5 w-3.5" /> : <ChevronDown className="ml-2 h-3.5 w-3.5" />}
        </Button>

        {cardsVisible && (
          <div className="space-y-3">
            {sources.slice(0, compact ? 3 : 6).map((source, index) => {
              const isExpanded = expandedIds.has(source.id);
              const title = source.title?.replace(/_chunk_\d+/g, `_page_${index + 1}`) || `근거 문서 ${index + 1}`;

              return (
                <div key={`${source.id}-${index}`} className="rounded-lg border border-[#E5E5E5] bg-white p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-[#E5E5E5] bg-[#F7F7F7] text-xs font-semibold text-[#5E5E5E]">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="line-clamp-2 break-words text-sm font-semibold leading-5 text-[#0D0D0D]">
                          {title}
                        </h4>
                        <div className="flex flex-none items-center gap-1">
                          {source.url && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 rounded-md p-0 text-[#5E5E5E] hover:bg-[#F4F5FF] hover:text-[#5E6AD2]"
                              onClick={() => handleSourceOpen(source)}
                              title={source.sourceType === "file" ? "파일 다운로드" : "열기"}
                              aria-label={source.sourceType === "file" ? "파일 다운로드" : "근거 문서 열기"}
                            >
                              {source.sourceType === "file" ? <Download className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 rounded-md p-0 text-[#5E5E5E] hover:bg-[#F4F4F4] hover:text-[#0D0D0D]"
                            onClick={() => toggleExpanded(source.id)}
                            title={isExpanded ? "접기" : "펼치기"}
                            aria-label={isExpanded ? "근거 문서 접기" : "근거 문서 펼치기"}
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>

                      <p className={`${isExpanded ? "" : "line-clamp-3"} mt-2 break-words text-xs leading-5 text-[#5E5E5E]`}>
                        {source.excerpt || "표시할 원문 일부가 없습니다."}
                      </p>

                      {isExpanded && (
                        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#E5E5E5] pt-3">
                          <Badge variant="outline" className="rounded-md border-[#D8DAF4] bg-[#F4F5FF] px-2 py-0.5 text-[11px] text-[#4F56B8]">
                            검증 근거
                          </Badge>
                          <Badge variant="outline" className="rounded-md border-[#E5E5E5] bg-white px-2 py-0.5 text-[11px] text-[#5E5E5E]">
                            Compass 색인
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
    <div className="border-b border-[#E5E5E5] bg-[#F7F7F7]/95 px-4 py-2.5 backdrop-blur rounded-none">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="min-w-0 flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg border border-[#D8DAF4] bg-[#ECEDF9] flex items-center justify-center">
            <Bot className="w-4 h-4 text-[#5E6AD2]" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[#0D0D0D]">
              AdMate Compass 정책 검색
            </h2>
            <p className="hidden text-xs text-[#5E5E5E] sm:block">
              정책 답변과 근거 문서를 함께 확인합니다.
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
                className="flex h-8 items-center space-x-2 rounded-md px-2 text-[#5E5E5E] transition-colors hover:bg-[#ECECEC] hover:text-[#0D0D0D] lg:hidden"
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
          <Badge variant="outline" className="hidden rounded-md border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 sm:inline-flex">
            Compass 색인 연결
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleRightPanel}
            className="hidden lg:flex items-center space-x-2 h-8 px-3 text-[#5E5E5E] hover:text-[#0D0D0D] hover:bg-[#ECECEC] transition-colors rounded-md"
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
          
          <Separator orientation="vertical" className="h-6 bg-[#E5E5E5] hidden lg:block" />
          
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewChat}
            className="flex items-center space-x-2 h-8 px-3 text-[#5E5E5E] hover:text-[#0D0D0D] hover:bg-[#ECECEC] transition-colors rounded-md"
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
      <div className="flex h-[calc(100vh-8rem)] w-full overflow-hidden mt-32 bg-[#F7F7F7]">
        {/* 1번 패널: 대화 히스토리 */}
        {!isLeftPanelCollapsed && (
          <div className="hidden w-72 border-r border-[#E5E5E5] h-full bg-white lg:block">
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
          <div className="hidden w-12 border-r border-[#E5E5E5] h-full bg-white lg:block">
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
          className="flex min-w-0 flex-col h-full bg-[#F7F7F7] lg:border-r lg:border-[#E5E5E5]"
          animate={{ 
            width: isMobileLayout || isRightPanelCollapsed ? '100%' : `${leftPanelWidth}%`,
            transition: isDragging ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }
          }}
        >
          <div className="h-3"></div>

          <div className="flex-1 min-w-0 overflow-y-auto p-2 sm:p-4 space-y-3 sm:space-y-4 custom-scrollbar bg-[#F7F7F7]">
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
                  <div className="rounded-lg border border-[#E5E5E5] bg-white px-4 py-3 shadow-sm">
                    <div className="flex items-start space-x-3">
                      <div className="w-8 h-8 rounded-lg border border-[#D8DAF4] bg-[#ECEDF9] flex items-center justify-center flex-shrink-0">
                        <Bot className="w-4 h-4 text-[#5E6AD2]" />
                      </div>
                      <div className="flex-1">
                        <div className="mb-2 text-sm font-medium text-[#0D0D0D]">Compass가 근거를 확인하고 있습니다</div>
                        <div className="flex flex-wrap gap-2 text-xs text-[#5E5E5E]">
                          <span className="rounded-md border border-[#E5E5E5] bg-[#F7F7F7] px-2 py-1">질문 분석 중</span>
                          <span className="rounded-md border border-[#E5E5E5] bg-[#F7F7F7] px-2 py-1">색인 검색 중</span>
                          <span className="rounded-md border border-[#E5E5E5] bg-[#F7F7F7] px-2 py-1">근거 검증 중</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {messages.length > 1 && (
              <div className="min-w-0 lg:hidden">
                <SourceStatePanel
                  state={latestPanelState}
                  userQuestion={latestUserMessage?.content}
                  sources={latestSources}
                  showContactOption={latestAssistantMessage?.showContactOption}
                  onContact={() => handleContactRequest(latestUserMessage?.content || "")}
                  onRetry={handleRetry}
                  compact
                />
              </div>
            )}
            
          </div>

          <div className="border-t border-[#E5E5E5] bg-white p-2 sm:p-3">
            <div className="mx-auto w-full max-w-4xl min-w-0">
              <div className="flex min-w-0 space-x-2 sm:space-x-3">
                <div className="relative min-w-0 flex-1">
                  <Textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="광고 플랫폼 정책과 가이드에 대해 궁금한 점을 질문해주세요..."
                    className="pr-10 sm:pr-12 resize-none min-h-[40px] sm:min-h-[44px] max-h-[100px] sm:max-h-[120px] text-sm sm:text-base border-[#D4D4D4] bg-white text-[#0D0D0D] placeholder-[#9A9A9A] focus:border-[#5E6AD2] focus:ring-[#ECEDF9]"
                    style={{ borderRadius: '8px' }}
                    disabled={isLoading}
                    rows={1}
                  />
                  <Button
                    size="sm"
                    onClick={handleSendMessage}
                    disabled={!inputValue.trim() || isLoading}
                    className="absolute right-1 sm:right-2 bottom-1 sm:bottom-2 h-7 w-7 sm:h-8 sm:w-8 p-0 bg-[#0D0D0D] hover:bg-[#2A2A2A] text-white rounded-md"
                  >
                    <Send className="w-3 h-3 sm:w-4 sm:h-4" />
                  </Button>
                </div>
              </div>
              
              <div className="mt-2 sm:mt-3 flex items-center justify-between text-xs text-[#777777]">
                <p className="hidden sm:block">Enter 키로 전송, Shift + Enter로 줄바꿈</p>
                <p className="sm:hidden">Enter로 전송</p>
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
            className="w-1 bg-[#E5E5E5] hover:bg-[#CBD0EF] cursor-col-resize transition-colors duration-200 hidden lg:block"
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
              className="hidden lg:flex flex-col bg-white h-full overflow-hidden"
            >
            <div className="border-b border-[#E5E5E5] bg-white p-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-lg border border-[#D8DAF4] bg-[#ECEDF9] flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-[#5E6AD2]" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[#0D0D0D]">근거 문서</h3>
                  <p className="text-sm text-[#5E5E5E]">현재 답변에 사용된 Compass 색인</p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#F7F7F7]">
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
