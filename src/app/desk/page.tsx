"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import MainLayout from "@/components/layouts/MainLayout";
import ChatBubble from "@/components/chat/ChatBubble";
import HistoryPanel from "@/components/chat/HistoryPanel";
import QuickQuestions from "@/components/chat/QuickQuestions";
import SourceStatePanel from "@/components/chat/SourceStatePanel";
import type { ChatSource, ChatUiState, CompassReviewPipeline } from "@/components/chat/chatUiStateTypes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Send, Bot, User, Star, ThumbsUp, ThumbsDown, RotateCcw, AlertCircle, CheckCircle, History, Target, Lightbulb, BookOpen, MessageSquare, Trash2, RefreshCw, PanelLeft, PanelRight, Maximize2, Minimize2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { saveCompassLocalConversation } from "@/lib/client/compassLocalHistory";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: string;
  sources?: ChatSource[];
  feedback?: {
    helpful: boolean | null;
    count: number;
    hermesQueued?: boolean;
    hermesStatus?: "candidate" | "queued" | "failed";
    persistence?: string;
  };
  conversationId?: string;
  noDataFound?: boolean;
  showContactOption?: boolean;
  confidence?: number;
  processingTime?: number;
  model?: string;
  uiState?: ChatUiState;
  isStreaming?: boolean;
  reviewPipeline?: CompassReviewPipeline;
  retrievalChannelTimedOut?: boolean;
}

type ActiveAnswerRequest =
  | { status: "idle" }
  | {
      status: "pending";
      requestId: string;
      question: string;
      startedAt: number;
      phase?: CompassAnswerPhase;
      sourceCount?: number;
      verifiedSourceCount?: number;
    };

type CompassAnswerPhase =
  | "submitted"
  | "accepted"
  | "evidence-started"
  | "evidence-ready"
  | "answer-started"
  | "answer-ready";

type CompassAnswerStreamEvent =
  | {
      type: "phase";
      phase: Exclude<CompassAnswerPhase, "submitted">;
      message?: string;
      sourceCount?: number;
      verifiedSourceCount?: number;
    }
  | {
      type: "final";
      status?: number;
      payload: any;
    }
  | {
      type: "delta";
      content: string;
    }
  | {
      type: "error";
      message?: string;
    };

type CompassAnswerFetchResult = {
  data: any;
  streamMessageId?: string;
};

const INITIAL_GREETING = "안녕하세요. Compass 근거 확인 화면입니다. 확인할 광고 문안이나 참고 출처를 붙여넣으면, 관련 출처와 추가 확인이 필요한 항목을 함께 정리해 드립니다.";
const NO_DATA_MESSAGE = "현재 Compass 문서에서 확인 가능한 출처를 찾지 못했습니다. 매체, 업종, 소재 표현을 더 구체적으로 입력하면 다시 확인할 수 있습니다.";
const GENERATION_LIMITED_MESSAGE = "답변 생성이 일시적으로 제한되었습니다. 확인한 출처는 아래에서 계속 확인할 수 있습니다.";
const ERROR_MESSAGE = "일시적인 서비스 오류로 답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";
const STREAM_CHUNK_DELAY_MS = 18;
const STREAM_CHUNK_SIZE = 18;

const getInitialMessage = (): Message => ({
  id: "1",
  type: "assistant",
  content: INITIAL_GREETING,
  timestamp: "방금 전",
  sources: [],
});

function CompassAuthRedirectState({ message }: { message: string }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#F4F5F0] px-6 text-[#111713]">
      <div className="text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[#D8DCCF] border-b-[#1F7A4D]" />
        <p className="text-sm font-medium text-[#5F6C62]">{message}</p>
      </div>
    </main>
  );
}

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
        title: String(item.title || item.originalTitle || `출처 문서 ${index + 1}`),
        url: typeof item.url === "string" && item.url.trim() ? item.url : undefined,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
        excerpt: String(item.excerpt || item.content || ""),
        sourceType: typeof item.sourceType === "string" ? item.sourceType : undefined,
        sourceVendor: typeof item.sourceVendor === "string" ? item.sourceVendor : undefined,
        sourceVendors: Array.isArray(item.sourceVendors) ? item.sourceVendors.filter((vendor): vendor is string => typeof vendor === "string") : undefined,
        isFallback: sourceQuality?.isFallback === true,
      };
    })
    .filter((source) => !source.isFallback && Boolean(source.title || source.excerpt))
    .map(({ isFallback, ...source }) => source);
};

const sanitizeReviewPipeline = (value: unknown): CompassReviewPipeline | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const pipeline = value as Record<string, unknown>;
  const steps: CompassReviewPipeline["steps"] = Array.isArray(pipeline.steps)
    ? pipeline.steps
      .filter((step) => step && typeof step === "object")
      .map((step) => {
        const item = step as Record<string, unknown>;
        const status: CompassReviewPipeline["steps"][number]["status"] = item.status === "limited" || item.status === "attention" || item.status === "completed"
          ? item.status
          : "completed";

        return {
          label: String(item.label || "검토"),
          description: String(item.description || ""),
          status,
        };
      })
      .filter((step) => step.label && step.description)
    : [];

  if (steps.length === 0) return undefined;

  const status = pipeline.status === "limited" || pipeline.status === "blocked" || pipeline.status === "error" || pipeline.status === "completed"
    ? pipeline.status
    : "completed";

  return {
    label: String(pipeline.label || "2단계 검토"),
    summary: String(pipeline.summary || "질문 조건과 출처 정합성을 단계적으로 확인했습니다."),
    status,
    steps,
    disclosure: typeof pipeline.disclosure === "string" ? pipeline.disclosure : undefined,
  };
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
  const [activeAnswerRequest, setActiveAnswerRequest] = useState<ActiveAnswerRequest>({ status: "idle" });
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
      const requestedPath = `${window.location.pathname}${window.location.search}`;
      window.location.href = `/?next=${encodeURIComponent(requestedPath)}`;
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
          const conversationPairs = getUnsavedConversationPairs(currentMessages, currentSavedIds);
          
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
                continue;
              }
            }

            if (saveConversationPairLocally(currentUser.id, uniqueId, userMsg, aiMsg)) {
              savedCount++;
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

  const isGenerationLimitedModel = (model?: string) => {
    return Boolean(model && (
      model === "compass-answer-connection-failed"
      || model.endsWith("-connection-failed")
    ));
  };

  const isRetrievalLimitedModel = (model?: string) => model === "compass-answer-retrieval-limited";

  const buildAssistantMessageFromResponse = (data: any): Message => {
    const safeSources = sanitizeSources(data?.response?.sources);
    const model = typeof data?.model === "string" ? data.model : undefined;
    const noDataFound = data?.response?.noDataFound === true && safeSources.length === 0;
    const generationLimited = isGenerationLimitedModel(model) && safeSources.length > 0;
    const retrievalLimited = isRetrievalLimitedModel(model) && safeSources.length === 0 && !noDataFound;
    const retrievalChannelTimedOut = data?.response?.sourceDiagnostics?.retrievalChannelTimedOut === true;
    const rawContent = data?.response?.message || data?.response?.content || "답변을 생성할 수 없습니다.";
    const uiState: ChatUiState | undefined = retrievalLimited ? "retrieval-limited" : generationLimited ? "generation-limited" : noDataFound ? "noData" : undefined;
    const reviewPipeline = sanitizeReviewPipeline(data?.response?.reviewPipeline || data?.reviewPipeline);
    if (retrievalChannelTimedOut && safeSources.length > 0 && reviewPipeline) {
      reviewPipeline.steps = [
        ...reviewPipeline.steps,
        {
          label: "검색 범위 점검",
          description: `일부 검색 경로가 제한되어 검증 출처 ${safeSources.length}개 기준으로 답변했습니다.`,
          status: "attention" as const,
        },
      ].slice(0, 4);
      if (reviewPipeline.status === "completed") {
        reviewPipeline.status = "limited";
      }
      reviewPipeline.summary = "질문 조건과 출처 정합성을 확인했으며, 일부 검색 경로 제한 여부도 함께 점검했습니다.";
    }

    return {
      id: (Date.now() + 1).toString(),
      type: "assistant",
      content: generationLimited ? GENERATION_LIMITED_MESSAGE : String(rawContent),
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
      reviewPipeline,
      retrievalChannelTimedOut,
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

  const waitForStreamFrame = () => new Promise<void>((resolve) => {
    window.setTimeout(resolve, STREAM_CHUNK_DELAY_MS);
  });

  const revealAssistantMessage = async (assistantMessage: Message): Promise<Message> => {
    const finalContent = assistantMessage.content;
    const streamingMessage: Message = {
      ...assistantMessage,
      content: "",
      isStreaming: true,
    };

    setMessages(prev => [...prev, streamingMessage]);

    let cursor = 0;
    while (cursor < finalContent.length) {
      cursor = Math.min(finalContent.length, cursor + STREAM_CHUNK_SIZE);
      const visibleContent = finalContent.slice(0, cursor);

      setMessages(prev => prev.map(message => (
        message.id === assistantMessage.id
          ? { ...message, content: visibleContent, isStreaming: true }
          : message
      )));

      await waitForStreamFrame();
    }

    const completedMessage = {
      ...assistantMessage,
      content: finalContent,
      isStreaming: false,
    };

    setMessages(prev => prev.map(message => (
      message.id === assistantMessage.id ? completedMessage : message
    )));

    return completedMessage;
  };

  const getUnsavedConversationPairs = (
    conversationMessages: Message[],
    currentSavedIds: Set<string>
  ) => {
    const pairs: Array<{ userMsg: Message; aiMsg: Message }> = [];

    for (let index = 0; index < conversationMessages.length - 1; index++) {
      const userMsg = conversationMessages[index];
      const aiMsg = conversationMessages[index + 1];

      if (userMsg.type !== "user" || aiMsg.type !== "assistant") continue;
      if (aiMsg.isStreaming) continue;
      if (currentSavedIds.has(userMsg.id) || currentSavedIds.has(aiMsg.id)) continue;

      pairs.push({ userMsg, aiMsg });
    }

    return pairs;
  };

  const saveConversationPairLocally = (
    userId: string,
    conversationId: string,
    userMessage: Message,
    aiResponse: Message
  ) => saveCompassLocalConversation(userId, {
    conversationId,
    userMessage: userMessage.content,
    aiResponse: aiResponse.content,
    sources: aiResponse.sources || [],
  });

  const saveConversationPair = async (userMessage: Message, aiResponse: Message) => {
    if (!user) return null;
    const uniqueId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${userMessage.id}_${aiResponse.id}`;

    try {
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

      const saveData = await saveResponse.json().catch(() => null);

      if (!saveResponse.ok || !saveData?.success) {
        console.warn('대화 자동 저장 실패:', saveData?.message || saveData?.error || saveResponse.status);
        const localSaved = saveConversationPairLocally(user.id, uniqueId, userMessage, aiResponse);
        if (!localSaved) return null;
      }

      setSavedMessageIds((current) => {
        const next = new Set(current);
        next.add(userMessage.id);
        next.add(aiResponse.id);
        return next;
      });
      setConversationId(uniqueId);
      setMessages(prev => prev.map(message => (
        message.id === aiResponse.id ? { ...message, conversationId: uniqueId } : message
      )));
      setHistoryRefreshTrigger((current) => current + 1);
      return uniqueId;
    } catch (saveError) {
      console.error('대화 자동 저장 오류:', saveError);
      const localSaved = saveConversationPairLocally(user.id, uniqueId, userMessage, aiResponse);
      if (localSaved) {
        setSavedMessageIds((current) => {
          const next = new Set(current);
          next.add(userMessage.id);
          next.add(aiResponse.id);
          return next;
        });
        setConversationId(uniqueId);
        setMessages(prev => prev.map(message => (
          message.id === aiResponse.id ? { ...message, conversationId: uniqueId } : message
        )));
        setHistoryRefreshTrigger((current) => current + 1);
      }
      return localSaved ? uniqueId : null;
    }
  };

  const updateAnswerPhase = (
    phase: CompassAnswerPhase,
    detail: { sourceCount?: number; verifiedSourceCount?: number } = {}
  ) => {
    setActiveAnswerRequest((current) => (
      current.status === "pending"
        ? { ...current, phase, ...detail }
        : current
    ));
  };

  const fetchCompassAnswerJson = async (message: string, conversationHistory: Message[]): Promise<CompassAnswerFetchResult> => {
    updateAnswerPhase("accepted");

    const response = await fetch('/api/compass-answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        conversationHistory,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || '응답을 받는 중 오류가 발생했습니다.');
    }

    updateAnswerPhase("answer-ready");
    return { data };
  };

  const appendStreamDelta = async (
    streamState: { streamMessageId?: string },
    delta: string
  ) => {
    if (!delta) return;
    updateAnswerPhase("answer-ready");

    if (!streamState.streamMessageId) {
      const streamMessageId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      streamState.streamMessageId = streamMessageId;
      setMessages(prev => [
        ...prev,
        {
          id: streamMessageId,
          type: "assistant",
          content: delta,
          timestamp: new Date().toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit'
          }),
          sources: [],
          feedback: { helpful: null, count: 0 },
          isStreaming: true,
        },
      ]);
      await waitForStreamFrame();
      return;
    }

    setMessages(prev => prev.map(message => (
      message.id === streamState.streamMessageId
        ? { ...message, content: `${message.content}${delta}`, isStreaming: true }
        : message
    )));
    await waitForStreamFrame();
  };

  const fetchCompassAnswerStream = async (
    message: string,
    conversationHistory: Message[],
    streamState: { streamMessageId?: string }
  ): Promise<CompassAnswerFetchResult> => {
    const response = await fetch('/api/compass-answer/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        conversationHistory,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error('Compass 스트림을 시작할 수 없습니다.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalPayload: any = null;
    let finalStatus = 200;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const event = JSON.parse(trimmed) as CompassAnswerStreamEvent;
        if (event.type === "phase") {
          updateAnswerPhase(event.phase, {
            sourceCount: event.sourceCount,
            verifiedSourceCount: event.verifiedSourceCount,
          });
        } else if (event.type === "final") {
          finalPayload = event.payload;
          finalStatus = event.status || 200;
        } else if (event.type === "delta") {
          await appendStreamDelta(streamState, event.content);
        } else if (event.type === "error") {
          throw new Error(event.message || 'Compass 스트림 처리 중 오류가 발생했습니다.');
        }
      }
    }

    const remaining = buffer.trim();
    if (remaining) {
      const event = JSON.parse(remaining) as CompassAnswerStreamEvent;
      if (event.type === "final") {
        finalPayload = event.payload;
        finalStatus = event.status || 200;
      } else if (event.type === "delta") {
        await appendStreamDelta(streamState, event.content);
      } else if (event.type === "error") {
        throw new Error(event.message || 'Compass 스트림 처리 중 오류가 발생했습니다.');
      }
    }

    if (!finalPayload) {
      throw new Error('Compass 스트림 최종 응답을 받지 못했습니다.');
    }

    if (finalStatus >= 400) {
      throw new Error(finalPayload.message || finalPayload.error || '응답을 받는 중 오류가 발생했습니다.');
    }

    return {
      data: finalPayload,
      streamMessageId: streamState.streamMessageId,
    };
  };

  const fetchCompassAnswer = async (message: string, conversationHistory: Message[]): Promise<CompassAnswerFetchResult> => {
    const streamState: { streamMessageId?: string } = {};

    try {
      return await fetchCompassAnswerStream(message, conversationHistory, streamState);
    } catch (streamError) {
      console.warn('Compass 스트림 응답 실패, JSON 응답으로 전환합니다:', streamError);
      if (streamState.streamMessageId) {
        setMessages(prev => prev.filter(message => message.id !== streamState.streamMessageId));
      }
      return fetchCompassAnswerJson(message, conversationHistory);
    }
  };

  const completeAssistantResponse = async (result: CompassAnswerFetchResult): Promise<Message> => {
    const aiResponse = buildAssistantMessageFromResponse(result.data);

    if (!result.streamMessageId) {
      return revealAssistantMessage(aiResponse);
    }

    const completedMessage: Message = {
      ...aiResponse,
      id: result.streamMessageId,
      isStreaming: false,
    };

    setMessages(prev => prev.map(message => (
      message.id === result.streamMessageId ? completedMessage : message
    )));

    return completedMessage;
  };

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
    setActiveAnswerRequest({
      status: "pending",
      requestId: `answer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question: question.trim(),
      startedAt: Date.now(),
      phase: "submitted",
    });
    setError(null);
    setLastSubmittedQuestion(question.trim());

    // 현재 메시지 상태를 기반으로 API 호출
    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);

    try {
      const answerResult = await fetchCompassAnswer(
        question.trim(),
        messages.slice(-10)
      );

      const completedAiResponse = await completeAssistantResponse(answerResult);
      setActiveAnswerRequest({ status: "idle" });
      
      // 대화 자동 저장
      if (user) {
        await saveConversationPair(userMessage, completedAiResponse);
      }

    } catch (error) {
      console.error('채팅 API 오류:', error);
      setError(ERROR_MESSAGE);
      setMessages(prev => [...prev, buildErrorMessage()]);
      
      toast({
        title: "오류 발생",
        description: "답변을 받는 중 문제가 발생했습니다.",
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setIsLoading(false);
      setActiveAnswerRequest({ status: "idle" });
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
    setActiveAnswerRequest({
      status: "pending",
      requestId: `answer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question: currentInput,
      startedAt: Date.now(),
      phase: "submitted",
    });
    setError(null);
    setLastSubmittedQuestion(currentInput);

    // 현재 메시지 상태를 기반으로 API 호출
    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);

    try {
      const answerResult = await fetchCompassAnswer(
        currentInput,
        messages.slice(-10)
      );

      const completedAiResponse = await completeAssistantResponse(answerResult);
      setActiveAnswerRequest({ status: "idle" });
      
      // 대화 자동 저장
      if (user) {
        await saveConversationPair(userMessage, completedAiResponse);
      }

    } catch (error) {
      console.error('채팅 API 오류:', error);
      setError(ERROR_MESSAGE);
      setMessages(prev => [...prev, buildErrorMessage()]);
      
      toast({
        title: "오류 발생",
        description: "답변을 받는 중 문제가 발생했습니다.",
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setIsLoading(false);
      setActiveAnswerRequest({ status: "idle" });
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

  const findQuestionForAssistant = (assistantMessageId?: string) => {
    if (!assistantMessageId) {
      return lastSubmittedQuestion || messages.filter(msg => msg.type === 'user').pop()?.content || "";
    }

    const assistantIndex = messages.findIndex(message => message.id === assistantMessageId);
    const searchStart = assistantIndex >= 0 ? assistantIndex - 1 : messages.length - 1;

    for (let index = searchStart; index >= 0; index -= 1) {
      if (messages[index]?.type === "user") {
        return messages[index].content;
      }
    }

    return lastSubmittedQuestion || "";
  };

  const shouldOfferContactForMessage = (message: Message) => (
    message.type === "assistant"
    && message.id !== "1"
    && !message.isStreaming
  );

  const handleContactRequest = async (question: string, assistantMessage?: Message) => {
    const actualQuestion = question || findQuestionForAssistant(assistantMessage?.id);
    const answerContext = assistantMessage?.content || "";

    setIsSendingEmail(true);
    
    // 메일 발송 중 메시지 추가
    const sendingMessage: Message = {
      id: `sending-${Date.now()}`,
      type: "assistant",
      content: "담당자 확인 메일 초안을 준비하고 있습니다...",
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
          answer: answerContext,
          sources: assistantMessage?.sources || [],
          model: assistantMessage?.model,
          confidence: assistantMessage?.confidence,
          userEmail: user?.email,
          userName: user?.user_metadata?.display_name || user?.user_metadata?.name || user?.email,
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
          content: "담당자 확인 메일 초안을 열었습니다.\n\n- 수신자: " + (data.recipient || "Compass 담당자") + "\n- 문의 내용: " + actualQuestion.substring(0, 80) + (actualQuestion.length > 80 ? "..." : "") + "\n- 작성 시간: " + new Date().toLocaleString('ko-KR') + "\n\n메일 앱에서 내용을 확인한 뒤 발송해 주세요.",
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
        content: "메일 초안을 여는 중 오류가 발생했습니다.\n\n**오류 내용:**\n" + (error instanceof Error ? error.message : "알 수 없는 오류") + "\n\n잠시 후 다시 시도해주시거나, 직접 Compass 담당자에게 문의해주세요.",
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
        const conversationPairs = getUnsavedConversationPairs(messages, savedMessageIds);
        
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
                continue;
              }
            }

            if (saveConversationPairLocally(user.id, uniqueId, userMsg, aiMsg)) {
              savedCount++;
              newSavedIds.add(userMsg.id);
              newSavedIds.add(aiMsg.id);
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
      // 답변 메시지의 피드백 정보 가져오기
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
          content: conversation.ai_response || "답변을 불러올 수 없습니다.",
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

    if (!message) {
      return;
    }

    const actualQuestion = findQuestionForAssistant(messageId);
    const feedbackConversationId = message.conversationId || conversationId || `feedback_${Date.now()}_${messageId}`;

    // UI 즉시 업데이트
    setMessages(prev => prev.map(msg => 
      msg.id === messageId 
        ? { 
            ...msg, 
            feedback: { 
              helpful, 
              count: msg.feedback?.helpful === null ? 1 : (msg.feedback?.count || 0),
              hermesStatus: "queued",
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
          userEmail: user?.email,
          userName: user?.user_metadata?.display_name || user?.user_metadata?.name || user?.email,
          conversationId: feedbackConversationId,
          messageId,
          helpful,
          question: actualQuestion,
          answer: message.content,
          sources: message.sources || [],
          model: message.model,
          confidence: message.confidence,
          reviewPipeline: message.reviewPipeline,
        }),
      });

      if (!response.ok) {
        throw new Error('피드백 저장에 실패했습니다.');
      }

      const data = await response.json();
      if (!data.success) {
        console.warn('피드백 저장 실패:', data.message);
        throw new Error(data.message || '피드백 저장에 실패했습니다.');
      }

      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? {
              ...msg,
              feedback: {
                helpful,
                count: msg.feedback?.count || 1,
                hermesQueued: data.hermesLearning?.queued === true,
                hermesStatus: data.hermesLearning?.queued === true ? "candidate" : "failed",
                persistence: data.hermesLearning?.persistence || data.feedbackPersistence,
              },
            }
          : msg
      ));

      toast({
        title: helpful ? "피드백이 기록되었습니다" : "출처 부족 의견이 기록되었습니다",
        description: data.hermesLearning?.queued
          ? "Hermes 학습 후보 큐에 함께 남겼습니다."
          : "피드백은 저장됐지만 Hermes 후보 큐 상태는 확인이 필요합니다.",
        duration: 2400,
      });
    } catch (error) {
      console.error('피드백 저장 오류:', error);
      // 에러 발생 시 UI 롤백
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, feedback: { helpful: null, count: 0 } }
          : msg
      ));
      toast({
        title: "피드백 저장 실패",
        description: "네트워크나 학습 후보 저장소 상태를 확인해 주세요.",
        variant: "destructive",
        duration: 3000,
      });
    }
  };


  const handleQuickQuestionClick = (question: string) => {
    setInputValue(question);
    // 자동으로 메시지 전송
    setTimeout(() => {
      handleSendMessageWithQuestion(question);
    }, 100);
  };

  const promptStarterChips = [
    { label: "문안 확인", prompt: "다음 광고 문안의 근거를 확인해줘:\n" },
    { label: "출처 추가", prompt: "다음 출처를 기준으로 문안을 대조해줘:\n" },
    { label: "표현 다듬기", prompt: "다음 문안에서 주의할 표현과 대체 문구를 정리해줘:\n" },
    {
      label: "다시 확인",
      prompt: lastSubmittedQuestion
        ? `${lastSubmittedQuestion}\n\n위 질문을 출처 중심으로 다시 확인해줘.`
        : "방금 검토한 내용을 출처 중심으로 다시 확인해줘.",
    },
  ];

  const handlePromptStarterClick = (prompt: string) => {
    setInputValue((current) => current.trim() ? `${current.trim()}\n${prompt}` : prompt);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      handleTextareaResize();
    });
  };

  const latestAssistantMessage = [...messages].reverse().find((message) => message.type === "assistant");
  const latestUserMessage = [...messages].reverse().find((message) => message.type === "user");
  const answerTextStreaming = latestAssistantMessage?.isStreaming === true;
  const answerPending = activeAnswerRequest.status === "pending" || answerTextStreaming;
  const latestSources = answerPending ? [] : sanitizeSources(latestAssistantMessage?.sources || []);
  const latestHasSources = latestSources.length > 0;
  const latestNoDataFound = !answerPending && latestAssistantMessage?.noDataFound === true;
  const latestGenerationLimited = latestAssistantMessage?.uiState === "generation-limited" || (isGenerationLimitedModel(latestAssistantMessage?.model) && latestHasSources);
  const latestRetrievalLimited = !answerPending && (latestAssistantMessage?.uiState === "retrieval-limited" || isRetrievalLimitedModel(latestAssistantMessage?.model));
  const latestIsError = !answerPending && latestAssistantMessage?.uiState === "error";
  const latestPanelState: ChatUiState = answerPending
    ? "answer-pending"
    : latestRetrievalLimited
      ? "retrieval-limited"
    : latestGenerationLimited
      ? "generation-limited"
      : latestNoDataFound
        ? "noData"
        : latestIsError
          ? "error"
          : latestHasSources
            ? "source-found"
            : "initial-empty";
  const panelUserQuestion = activeAnswerRequest.status === "pending" ? activeAnswerRequest.question : latestUserMessage?.content;
  const panelShowContactOption = !answerPending && latestAssistantMessage?.showContactOption;
  const pendingPhase: CompassAnswerPhase = activeAnswerRequest.status === "pending" ? activeAnswerRequest.phase || "submitted" : "submitted";
  const pendingVerifiedSourceCount = activeAnswerRequest.status === "pending" ? activeAnswerRequest.verifiedSourceCount : undefined;
  const pendingPhaseCopy: Record<CompassAnswerPhase, { title: string; detail: string; activeLabel: string; nextLabel: string; progress: number }> = {
    submitted: {
      title: "질문을 보냈습니다. Compass가 요청을 접수하는 중입니다.",
      detail: "생각중... 질문 문맥과 매체 조건을 정리하고 있습니다.",
      activeLabel: "요청 전송",
      nextLabel: "출처 검색 준비",
      progress: 12,
    },
    accepted: {
      title: "질문을 접수했습니다. 질문 조건을 정리하는 중입니다.",
      detail: "생각중... 플랫폼, 정책 항목, 소재 유형을 분리하고 있습니다.",
      activeLabel: "요청 접수",
      nextLabel: "출처 검색",
      progress: 24,
    },
    "evidence-started": {
      title: "관련 매체 정책과 문서 출처를 검색하는 중입니다.",
      detail: "생각중... 벡터 검색과 키워드 검색을 함께 돌려 근거 후보를 찾고 있습니다.",
      activeLabel: "출처 검색",
      nextLabel: "출처 선별",
      progress: 44,
    },
    "evidence-ready": {
      title: pendingVerifiedSourceCount !== undefined
        ? `확인 가능한 출처 ${pendingVerifiedSourceCount}개를 선별했습니다.`
        : "확인 가능한 출처를 선별했습니다.",
      detail: "생각중... 답변에 사용할 수 있는 출처만 다시 걸러내고 있습니다.",
      activeLabel: "출처 선별",
      nextLabel: "답변 정리",
      progress: 64,
    },
    "answer-started": {
      title: "선별된 출처를 기준으로 답변을 정리하는 중입니다.",
      detail: "생각중... 1차 답변을 만들고 2차 검토로 근거 범위를 확인하고 있습니다.",
      activeLabel: "답변 정리",
      nextLabel: "화면 표시",
      progress: 82,
    },
    "answer-ready": {
      title: "답변 정리가 완료되어 화면에 표시하는 중입니다.",
      detail: "답변을 한 줄씩 표시하고 있습니다.",
      activeLabel: "답변 준비 완료",
      nextLabel: "출처 표시",
      progress: 96,
    },
  };
  const needsAdditionalReview = latestNoDataFound || latestGenerationLimited || latestRetrievalLimited || latestIsError;
  const finalReviewReady = latestHasSources && !needsAdditionalReview;
  const reviewPostureItems = [
    {
      label: "1차 검토",
      value: lastSubmittedQuestion ? "문안 맥락 확인" : "입력 대기",
      Icon: CheckCircle,
      className: lastSubmittedQuestion
        ? "border-[#C6D9CB] bg-[#EDF7EF] text-[#1F7A4D]"
        : "border-[#D8DCCF] bg-white text-[#5F6C62]",
      iconClassName: lastSubmittedQuestion ? "text-[#1F7A4D]" : "text-[#8B9388]",
    },
    {
      label: "출처 대조",
      value: latestHasSources ? `출처 ${latestSources.length}개 대조` : "정책 원문 확인",
      Icon: BookOpen,
      className: latestHasSources
        ? "border-[#C6D9CB] bg-white text-[#1F7A4D]"
        : "border-[#D8DCCF] bg-white text-[#5F6C62]",
      iconClassName: latestHasSources ? "text-[#1F7A4D]" : "text-[#8B9388]",
    },
    {
      label: "최종 검토",
      value: finalReviewReady ? "답변 정리 완료" : needsAdditionalReview ? "추가 확인 필요" : "대기",
      Icon: needsAdditionalReview ? AlertCircle : Target,
      className: needsAdditionalReview
        ? "border-[#E9D59B] bg-[#FFF8E6] text-[#8A6418]"
        : finalReviewReady
          ? "border-[#C6D9CB] bg-white text-[#1F7A4D]"
          : "border-[#D8DCCF] bg-white text-[#5F6C62]",
      iconClassName: needsAdditionalReview
        ? "text-[#9E5700]"
        : finalReviewReady
          ? "text-[#1F7A4D]"
          : "text-[#8B9388]",
    },
  ] as const;
  const chatHeader = (
    <div className="rounded-none border-b border-[#D8DCCF] bg-[#FBFBF7]/95 px-4 py-2 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 lg:flex-nowrap">
        <div className="flex min-w-[12rem] items-center gap-2">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF]">
            <Bot className="h-4 w-4 text-[#1F7A4D]" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-[#111713]">
              근거 확인
            </h2>
            <p className="hidden text-xs text-[#5F6C62] xl:block">
              광고 문안의 주장과 출처를 함께 확인합니다.
            </p>
          </div>
        </div>

        <div className="compass-review-rail order-3 grid w-full grid-cols-3 gap-1.5 text-[11px] sm:flex sm:w-auto sm:min-w-0 sm:flex-1 sm:items-center sm:gap-1.5 lg:order-none">
          {reviewPostureItems.map(({ label, value, Icon, className, iconClassName }) => {
            const PostureIcon = Icon;

            return (
              <div
                key={label}
                className={`compass-review-step flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 ${className}`}
              >
                <PostureIcon className={`h-3.5 w-3.5 flex-none ${iconClassName}`} />
                <span className="font-semibold">{label}</span>
                <span className="ml-auto hidden min-w-0 text-right text-[10px] leading-4 opacity-80 md:inline">
                  {value}
                </span>
              </div>
            );
          })}
        </div>
        
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="대화 히스토리 열기"
                className="flex h-8 items-center space-x-2 rounded-md px-2 text-[#5F6C62] transition-colors hover:bg-[#EDF7EF] hover:text-[#111713] lg:hidden"
              >
                <History className="w-4 h-4" />
                <span className="hidden text-xs sm:inline">기록</span>
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
              {isRightPanelCollapsed ? "근거 패널 펼치기" : "근거 패널 접기"}
            </span>
          </Button>
          
          <Separator orientation="vertical" className="hidden h-6 bg-[#D8DCCF] lg:block" />
          
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewChat}
            className="flex h-8 items-center space-x-2 rounded-md px-3 text-[#5F6C62] transition-colors hover:bg-[#EDF7EF] hover:text-[#111713]"
            aria-label="새 근거 확인"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden text-xs sm:inline">새 근거 확인</span>
          </Button>
        </div>
      </div>
    </div>
  );

  // 로딩 중이거나 로그인하지 않은 경우
  if (loading) {
    return <CompassAuthRedirectState message="로그인 상태를 확인하는 중..." />;
  }

  if (!user) {
    return <CompassAuthRedirectState message="Compass 로그인 화면으로 이동하는 중..." />;
  }

  return (
    <MainLayout chatHeader={chatHeader}>
      <div className="flex h-full min-h-0 w-full overflow-hidden bg-[#F4F5F0]">
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
                onContact={shouldOfferContactForMessage(message) ? () => handleContactRequest(findQuestionForAssistant(message.id), message) : undefined}
                noDataFound={message.noDataFound}
                showContactOption={Boolean(message.showContactOption)}
                confidence={message.confidence}
                processingTime={message.processingTime}
                model={message.uiState === "generation-limited" || message.uiState === "retrieval-limited" ? message.model : undefined}
                isStreaming={message.isStreaming}
                reviewPipeline={message.reviewPipeline}
                retrievalChannelTimedOut={message.retrievalChannelTimedOut}
              />
            ))}
            
            {activeAnswerRequest.status === "pending" && !answerTextStreaming && (
              <div className="flex justify-start">
                <div className="max-w-3xl">
                  <div className="rounded-lg border border-[#D8DCCF] bg-[#FBFBF7] px-4 py-3 shadow-sm" aria-live="polite">
                    <div className="flex items-start space-x-3">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF]">
                        <Bot className="h-4 w-4 text-[#1F7A4D]" />
                      </div>
                      <div className="flex-1">
                        <div className="mb-1 flex items-center gap-2 text-sm font-medium text-[#111713]">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#1F7A4D]" />
                          <span>{pendingPhaseCopy[pendingPhase].title}</span>
                        </div>
                        <p className="mb-3 text-xs leading-5 text-[#5F6C62]">{pendingPhaseCopy[pendingPhase].detail}</p>
                        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[#E7EADF]">
                          <div
                            className="h-full rounded-full bg-[#1F7A4D] transition-all duration-500"
                            style={{ width: `${pendingPhaseCopy[pendingPhase].progress}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-[#5F6C62]">
                          <span className="rounded-md border border-[#C6D9CB] bg-white px-2 py-1 text-[#1F7A4D]">{pendingPhaseCopy[pendingPhase].activeLabel}</span>
                          <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1">{pendingPhaseCopy[pendingPhase].nextLabel}</span>
                          <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1">도착 후 출처 표시</span>
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
                  <span>출처 확인</span>
                  <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1 text-[#34423A]">
                    {latestSources.length}개 출처
                  </span>
                </div>
                <SourceStatePanel
                  state={latestPanelState}
                  userQuestion={panelUserQuestion}
                  sources={latestSources}
                  showContactOption={panelShowContactOption}
                  partialRetrievalLimited={latestAssistantMessage?.retrievalChannelTimedOut === true && latestHasSources}
                  onContact={() => handleContactRequest(panelUserQuestion || "")}
                  onRetry={handleRetry}
                  onPromptSelect={handleQuickQuestionClick}
                  compact
                />
              </div>
            )}
            
          </div>

          <div className="border-t border-[#D8DCCF] bg-[#FBFBF7] p-2 sm:p-3">
            <div className="mx-auto w-full max-w-4xl min-w-0">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {promptStarterChips.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => handlePromptStarterClick(chip.prompt)}
                    disabled={isLoading}
                    className="rounded-md border border-[#D8DCCF] bg-white px-2.5 py-1 text-xs font-medium text-[#34423A] transition-colors hover:border-[#B9C9BB] hover:bg-[#EDF7EF] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <div className="flex min-w-0 space-x-2 sm:space-x-3">
                <div className="relative min-w-0 flex-1">
                  <Textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="확인할 문안이나 출처를 붙여넣으세요"
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
                <p className="hidden sm:block">매체, 업종, 표현 맥락을 함께 쓰면 더 가까운 출처를 찾을 수 있습니다.</p>
                <p className="sm:hidden">출처는 답변 아래 표시됩니다.</p>
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
                  <h3 className="text-base font-semibold text-[#111713]">근거 패널</h3>
                  <p className="text-sm text-[#5F6C62]">답변에 연결된 출처와 추가 확인 항목을 대조합니다.</p>
                </div>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-[#F4F5F0] p-4">
              {/* 질문이 있을 때만 관련 자료와 빠른 질문 표시 */}
              {messages.length > 1 ? (
                <>
                  <SourceStatePanel
                    state={latestPanelState}
                    userQuestion={panelUserQuestion}
                    sources={latestSources}
                    showContactOption={panelShowContactOption}
                    partialRetrievalLimited={latestAssistantMessage?.retrievalChannelTimedOut === true && latestHasSources}
                    onContact={() => handleContactRequest(panelUserQuestion || "")}
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
                <SourceStatePanel
                  state="initial-empty"
                  sources={[]}
                  onPromptSelect={handleQuickQuestionClick}
                />
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
