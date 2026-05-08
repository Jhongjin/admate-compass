"use client";

import { useState, useRef, useEffect, Suspense } from "react";
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
  confidence?: number;
  processingTime?: number;
  model?: string;
}

function ChatPageContent() {
  const { user, loading } = useAuth();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
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
      setMessages([
        {
          id: "1",
          type: "assistant",
          content: "안녕하세요! AdMate Compass입니다. 광고 플랫폼 정책, 가이드라인, 설정 방법에 대해 궁금한 점을 질문하면 RAG 기반 답변과 관련 출처를 함께 제공합니다.",
          timestamp: "방금 전",
          sources: [],
        },
      ]);
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

      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: data.response.message || data.response.content || '답변을 생성할 수 없습니다.',
        timestamp: new Date().toLocaleTimeString('ko-KR', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        sources: data.response.sources || [],
        feedback: { helpful: null, count: 0 },
        noDataFound: data.response.noDataFound || false,
        showContactOption: data.response.showContactOption || false,
        confidence: data.confidence,
        processingTime: data.processingTime,
        model: data.model
      };

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
      setError(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: `죄송합니다. 현재 서비스에 일시적인 문제가 발생했습니다.\n\n${error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'}\n\n잠시 후 다시 시도해주세요.`,
        timestamp: new Date().toLocaleTimeString('ko-KR', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        sources: [],
        feedback: { helpful: null, count: 0 },
      };

      setMessages(prev => [...prev, errorMessage]);
      
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

      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: data.response.message || data.response.content || '답변을 생성할 수 없습니다.',
        timestamp: new Date().toLocaleTimeString('ko-KR', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        sources: data.response.sources || [],
        feedback: { helpful: null, count: 0 },
        noDataFound: data.response.noDataFound || false,
        showContactOption: data.response.showContactOption || false,
        confidence: data.confidence,
        processingTime: data.processingTime,
        model: data.model
      };

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
      setError(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: `죄송합니다. 현재 서비스에 일시적인 문제가 발생했습니다.\n\n${error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'}\n\n잠시 후 다시 시도해주세요.`,
        timestamp: new Date().toLocaleTimeString('ko-KR', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        sources: [],
        feedback: { helpful: null, count: 0 },
      };

      setMessages(prev => [...prev, errorMessage]);
      
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
    
    setMessages([
      {
        id: "1",
        type: "assistant",
        content: "안녕하세요! AdMate Compass입니다. 광고 플랫폼 정책, 가이드라인, 설정 방법에 대해 궁금한 점을 질문하면 RAG 기반 답변과 관련 출처를 함께 제공합니다.",
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
        {
          id: "1",
          type: "assistant",
          content: "안녕하세요! AdMate Compass입니다. 광고 플랫폼 정책, 가이드라인, 설정 방법에 대해 궁금한 점을 질문하면 RAG 기반 답변과 관련 출처를 함께 제공합니다.",
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
  const latestSources = latestAssistantMessage?.sources || [];
  const latestHasSources = latestSources.length > 0;
  const latestNoDataFound = latestAssistantMessage?.noDataFound === true;
  const latestGenerationLimited = latestAssistantMessage?.model === "ollama-connection-failed" && latestHasSources;

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
                sources={message.sources}
                feedback={message.feedback}
                onFeedback={(helpful) => handleFeedback(message.id, helpful)}
                noDataFound={message.noDataFound}
                showContactOption={message.showContactOption}
                confidence={message.confidence}
                processingTime={message.processingTime}
                model={message.model}
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
                <RelatedResources
                  userQuestion={latestUserMessage?.content}
                  aiResponse={latestAssistantMessage?.content}
                  sources={latestSources as any}
                  noDataFound={latestNoDataFound}
                  generationLimited={latestGenerationLimited}
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
                  {/* 관련 자료 컴포넌트 - 상단 배치 */}
                  <RelatedResources 
                    userQuestion={latestUserMessage?.content}
                    aiResponse={latestAssistantMessage?.content}
                    sources={latestSources as any}
                    noDataFound={latestNoDataFound}
                    generationLimited={latestGenerationLimited}
                  />
                  
                  {/* 빠른 질문 컴포넌트 - 하단 배치 */}
                  <QuickQuestions 
                    onQuestionClick={handleQuickQuestionClick} 
                    currentQuestion={messages[messages.length - 2]?.content}
                  />
                </>
              ) : (
                /* 초기 상태 - 안내 메시지 */
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-16 h-16 rounded-lg border border-[#E5E5E5] bg-white flex items-center justify-center mb-5">
                    <BookOpen className="w-8 h-8 text-[#5E6AD2]" />
                  </div>
                  <h3 className="text-base font-semibold text-[#0D0D0D] mb-2">질문을 시작해보세요</h3>
                  <p className="text-sm text-[#5E5E5E] max-w-sm leading-relaxed">
                    광고 플랫폼 정책이나 소재 기준을 질문하면 관련 근거 문서가 이 영역에 표시됩니다.
                  </p>
                </div>
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
