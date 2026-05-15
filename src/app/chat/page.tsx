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
          content: "안녕하세요! 메타 광고 FAQ AI 챗봇입니다. 광고 정책, 가이드라인, 설정 방법 등에 대해 궁금한 점이 있으시면 자유롭게 질문해주세요. 한국어로 질문하시면 됩니다.",
          timestamp: "방금 전",
          sources: [],
        },
      ]);
      setIsInitialized(true);
    }
  }, [isInitialized]);


  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsRightPanelCollapsed(true);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 로그인 상태 확인
  useEffect(() => {
    if (!loading && !user) {
      // 로그인하지 않은 사용자는 메인 페이지로 리다이렉트
      window.location.href = '/';
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
      const response = await fetch('/api/chat', {
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
      const response = await fetch('/api/chat', {
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
        showContactOption: data.response.showContactOption || false
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
        content: "안녕하세요! 메타 광고 FAQ AI 챗봇입니다. 광고 정책, 가이드라인, 설정 방법 등에 대해 궁금한 점이 있으시면 자유롭게 질문해주세요. 한국어로 질문하시면 됩니다.",
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
          content: "안녕하세요! 메타 광고 FAQ AI 챗봇입니다. 광고 정책, 가이드라인, 설정 방법 등에 대해 궁금한 점이 있으시면 자유롭게 질문해주세요. 한국어로 질문하시면 됩니다.",
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

  const latestUserMessage = [...messages].reverse().find((message) => message.type === "user");
  const latestAssistantMessage = [...messages].reverse().find((message) => message.type === "assistant");
  const latestSourceCount = latestAssistantMessage?.sources?.length || 0;
  const latestSources = latestAssistantMessage?.sources?.slice(0, 3) || [];
  const hasActiveReview = messages.length > 1;
  const reviewStatusLabel = isLoading ? "근거 검색 중" : latestSourceCount > 0 ? "출처 대조 가능" : hasActiveReview ? "근거 보강 필요" : "접수 대기";
  const reviewCaseId = latestUserMessage ? `CASE-${latestUserMessage.id.slice(-6).toUpperCase()}` : "CASE-READY";
  const sourceCoverageLabel = latestSourceCount > 0 ? `${Math.min(latestSourceCount, 3)}/${latestSourceCount} previewed` : "0 sources";

  const chatHeader = (
    <div className="border-b border-[#D8DCCF] bg-[#FBFBF7]/95 px-4 py-3 backdrop-blur rounded-none">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center space-x-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF] shadow-sm">
            <FileText className="h-4 w-4 text-[#1F7A4D]" />
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-[#111713]">
                Compass 정책 근거 데스크
              </h2>
              <Badge variant="outline" className="hidden rounded-md border-[#C6D9CB] bg-[#EDF7EF] px-2 py-0.5 text-[11px] font-medium text-[#1F7A4D] sm:inline-flex">
                Evidence mode
              </Badge>
              <Badge variant="outline" className="hidden rounded-md border-[#D8DCCF] bg-white px-2 py-0.5 text-[11px] font-medium text-[#5F6C62] md:inline-flex">
                {reviewStatusLabel}
              </Badge>
            </div>
            <p className="truncate text-xs text-[#5F6C62]">
              질문, 검토 메모, 인용 후보를 한 화면에서 대조합니다.
            </p>
          </div>
        </div>
        
        <div className="flex flex-none items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleRightPanel}
            className="hidden h-8 items-center space-x-2 rounded-md border border-[#D8DCCF] bg-white px-3 text-[#34423A] transition-colors hover:bg-[#EDF7EF] hover:text-[#111713] lg:flex"
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
          
          <Separator orientation="vertical" className="h-6 bg-[#D8DCCF] hidden lg:block" />
          
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewChat}
            className="flex h-8 items-center space-x-2 rounded-md border border-[#D8DCCF] bg-white px-3 text-[#34423A] transition-colors hover:bg-[#EDF7EF] hover:text-[#111713]"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="text-xs">새 대화</span>
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
      <div className="mt-32 flex h-[calc(100vh-8rem)] bg-[#F4F5F0]">
        {/* 1번 패널: 대화 히스토리 */}
        {!isLeftPanelCollapsed && (
          <div className="h-full w-72 border-r border-[#D8DCCF] bg-[#FBFBF7]">
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
          <div className="h-full w-12 border-r border-[#D8DCCF] bg-[#FBFBF7]">
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
          className="flex h-full flex-col border-r border-[#D8DCCF] bg-[#F4F5F0] lg:border-r"
          animate={{ 
            width: isRightPanelCollapsed ? '100%' : `${leftPanelWidth}%`,
            transition: isDragging ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }
          }}
        >
          <div className="border-b border-[#E2E5DA] bg-[#FBFBF7] px-4 py-2">
            <div className="mx-auto grid max-w-4xl gap-2 text-xs text-[#5F6C62] sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-semibold text-[#111713]">검토 작업대</span>
                <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1">질문 접수</span>
                <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1">정책 답변</span>
                <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1">출처 대조</span>
              </div>
              <div className="flex flex-wrap gap-1.5 sm:justify-end">
                <span className="rounded-md border border-[#C6D9CB] bg-[#EDF7EF] px-2 py-1 font-medium text-[#1F7A4D]">
                  인용 후보 {latestSourceCount}개
                </span>
                <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1">
                  {reviewStatusLabel}
                </span>
              </div>
            </div>
            <div className="mx-auto mt-2 grid max-w-4xl gap-1.5 font-mono text-[11px] text-[#5F6C62] sm:grid-cols-3">
              <div className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1.5">
                <span className="text-[#8A9388]">CASE</span>
                <span className="ml-2 font-semibold text-[#111713]">{reviewCaseId}</span>
              </div>
              <div className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1.5">
                <span className="text-[#8A9388]">SOURCES</span>
                <span className="ml-2 font-semibold text-[#111713]">{sourceCoverageLabel}</span>
              </div>
              <div className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1.5">
                <span className="text-[#8A9388]">MODE</span>
                <span className="ml-2 font-semibold text-[#111713]">POLICY-REVIEW</span>
              </div>
            </div>
          </div>

          <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto bg-[#F4F5F0] p-2 sm:space-y-4 sm:p-4">
            {!hasActiveReview && (
              <div className="mx-auto max-w-4xl rounded-lg border border-[#D8DCCF] bg-[#FBFBF7] p-3 shadow-sm sm:p-4">
                <div className="grid gap-3 sm:grid-cols-[1.1fr_0.9fr] sm:items-start">
                  <div>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#758070]">
                      Review intake
                    </div>
                    <h3 className="text-sm font-semibold text-[#111713]">정책 판단에 필요한 단서를 먼저 정리합니다</h3>
                    <p className="mt-1 max-w-xl text-xs leading-5 text-[#5F6C62]">
                      플랫폼, 업종, 소재 문구, 랜딩 조건을 함께 입력하면 답변과 인용 후보를 더 안정적으로 대조할 수 있습니다.
                    </p>
                  </div>
                  <div className="grid gap-1.5 text-xs text-[#34423A]">
                    {["플랫폼/게재면", "업종/상품", "소재 표현", "랜딩 페이지 조건"].map((item) => (
                      <div key={item} className="flex items-center gap-2 rounded-md border border-[#D8DCCF] bg-white px-2.5 py-2">
                        <CheckCircle className="h-3.5 w-3.5 flex-none text-[#1F7A4D]" />
                        <span className="truncate">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

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
              />
            ))}
            
            {isLoading && (
              <div className="flex justify-start">
                <div className="max-w-3xl">
                  <div className="rounded-lg border border-[#D6D8CD] bg-white px-4 py-3 shadow-sm">
                    <div className="flex items-start space-x-3">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF]">
                        <FileText className="h-4 w-4 text-[#1F7A4D]" />
                      </div>
                      <div className="flex-1 space-y-2">
                        <div className="text-xs font-semibold text-[#111713]">정책 근거를 대조하는 중</div>
                        <div className="space-y-2">
                          <div className="h-2 w-48 animate-pulse rounded-full bg-[#D8DCCF]" />
                          <div className="h-2 w-64 max-w-full animate-pulse rounded-full bg-[#E9ECE3]" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
          </div>

          <div className="border-t border-[#D8DCCF] bg-[#FBFBF7]/95 p-2 backdrop-blur-sm sm:p-3">
            <div className="max-w-4xl mx-auto">
              <div className="flex space-x-2 sm:space-x-3">
                <div className="flex-1 relative">
                  <Textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder="플랫폼, 업종, 소재 표현을 함께 입력해 정책 근거를 확인하세요."
                    className="max-h-[100px] min-h-[40px] resize-none rounded-lg border-[#C6D9CB] bg-white pr-10 text-sm text-[#111713] placeholder:text-[#7A8378] focus:border-[#1F7A4D] focus:ring-[#1F7A4D]/20 sm:max-h-[120px] sm:min-h-[44px] sm:pr-12 sm:text-base"
                    disabled={isLoading}
                    rows={1}
                  />
                  <Button
                    size="sm"
                    onClick={handleSendMessage}
                    disabled={!inputValue.trim() || isLoading}
                    className="absolute bottom-1 right-1 h-7 w-7 rounded-md bg-[#1F7A4D] p-0 text-white shadow-sm transition-colors hover:bg-[#176B42] sm:bottom-2 sm:right-2 sm:h-8 sm:w-8"
                  >
                    <Send className="w-3 h-3 sm:w-4 sm:h-4" />
                  </Button>
                </div>
              </div>
              
              <div className="mt-2 flex items-center justify-between text-xs text-[#5F6C62] sm:mt-3">
                <p className="hidden sm:block">Enter 키로 전송, Shift + Enter로 줄바꿈</p>
                <p className="sm:hidden">Enter로 전송</p>
                {error && (
                  <div className="flex items-center space-x-1 text-[#B42318]">
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
            className="hidden w-1 cursor-col-resize bg-[#D8DCCF] transition-colors duration-200 hover:bg-[#1F7A4D] lg:block"
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
              className="hidden h-full flex-col overflow-hidden bg-[#FBFBF7] lg:flex"
            >
            <div className="border-b border-[#D8DCCF] bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center space-x-3">
                  <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF] shadow-sm">
                    <BookOpen className="h-5 w-5 text-[#1F7A4D]" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-[#111713]">근거 작업공간</h3>
                    <p className="truncate text-sm text-[#5F6C62]">출처, 후속 질문, 검토 기준</p>
                  </div>
                </div>
                <div className="flex flex-none flex-col items-end gap-1 text-xs">
                  <span className="rounded-md border border-[#C6D9CB] bg-[#EDF7EF] px-2 py-1 font-medium text-[#1F7A4D]">
                    {latestSourceCount} sources
                  </span>
                  <span className="text-[#758070]">{reviewStatusLabel}</span>
                </div>
              </div>
              <div className="mt-3 grid gap-2 font-mono text-[11px] text-[#5F6C62] sm:grid-cols-3">
                <div className="rounded-md border border-[#D8DCCF] bg-[#FBFBF7] px-2 py-1.5">
                  <div className="text-[#8A9388]">CASE</div>
                  <div className="mt-0.5 truncate font-semibold text-[#111713]">{reviewCaseId}</div>
                </div>
                <div className="rounded-md border border-[#D8DCCF] bg-[#FBFBF7] px-2 py-1.5">
                  <div className="text-[#8A9388]">LEDGER</div>
                  <div className="mt-0.5 truncate font-semibold text-[#111713]">{sourceCoverageLabel}</div>
                </div>
                <div className="rounded-md border border-[#D8DCCF] bg-[#FBFBF7] px-2 py-1.5">
                  <div className="text-[#8A9388]">STATUS</div>
                  <div className="mt-0.5 truncate font-semibold text-[#111713]">{reviewStatusLabel}</div>
                </div>
              </div>
              {latestUserMessage && (
                <div className="mt-3 rounded-md border border-[#D8DCCF] bg-[#FBFBF7] p-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#758070]">
                    Current question
                  </div>
                  <p className="line-clamp-2 break-words text-xs leading-5 text-[#34423A]">
                    {latestUserMessage.content}
                  </p>
                </div>
              )}
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* 질문이 있을 때만 관련 자료와 빠른 질문 표시 */}
              {messages.length > 1 ? (
                <>
                  <div className="rounded-xl border border-[#D8DCCF] bg-white shadow-sm">
                    <div className="border-b border-[#E2E5DA] px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#758070]">
                            Evidence terminal
                          </div>
                          <h4 className="mt-1 truncate text-sm font-semibold text-[#111713]">인용 후보 점검 로그</h4>
                        </div>
                        <span className="flex-none rounded-md border border-[#C6D9CB] bg-[#EDF7EF] px-2 py-1 text-xs font-medium text-[#1F7A4D]">
                          {latestSourceCount}개
                        </span>
                      </div>
                    </div>
                    <div className="divide-y divide-[#E2E5DA]">
                      {latestSources.length > 0 ? (
                        latestSources.map((source, index) => (
                          <div key={`${source.id}-${index}`} className="grid grid-cols-[2.25rem_1fr] gap-3 px-4 py-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[#C6D9CB] bg-[#EDF7EF] text-[11px] font-semibold text-[#1F7A4D]">
                              {String(index + 1).padStart(2, "0")}
                            </div>
                            <div className="min-w-0">
                              <div className="line-clamp-2 break-words text-xs font-semibold leading-5 text-[#111713]">
                                {source.title || `근거 문서 ${index + 1}`}
                              </div>
                              <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-[#5F6C62]">
                                {source.excerpt || "원문 일부가 표시되지 않았습니다."}
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[#758070]">
                                <span className="rounded-md border border-[#D8DCCF] bg-[#FBFBF7] px-2 py-0.5">출처 대조</span>
                                <span className="rounded-md border border-[#D8DCCF] bg-[#FBFBF7] px-2 py-0.5">
                                  {source.updatedAt ? new Date(source.updatedAt).toLocaleDateString("ko-KR") : "날짜 미확인"}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="px-4 py-4 text-xs leading-5 text-[#5F6C62]">
                          아직 연결된 인용 후보가 없습니다. 질문 범위를 좁히면 이 영역에 출처 점검 로그가 표시됩니다.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 관련 자료 컴포넌트 - 상단 배치 */}
                  <RelatedResources 
                    userQuestion={messages[messages.length - 2]?.content}
                    aiResponse={messages[messages.length - 1]?.content}
                    sources={messages[messages.length - 1]?.sources as any || []}
                  />
                  
                  {/* 빠른 질문 컴포넌트 - 하단 배치 */}
                  <QuickQuestions 
                    onQuestionClick={handleQuickQuestionClick} 
                    currentQuestion={messages[messages.length - 2]?.content}
                  />
                </>
              ) : (
                /* 초기 상태 - 안내 메시지 */
                <div className="space-y-4 py-8">
                  <div className="rounded-xl border border-[#D8DCCF] bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF]">
                        <Target className="h-5 w-5 text-[#1F7A4D]" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-[#111713]">정책 검토를 시작하세요</h3>
                        <p className="text-xs text-[#5F6C62]">질문을 보내면 이 패널이 근거 보드로 전환됩니다.</p>
                      </div>
                    </div>
                    <p className="text-xs leading-5 text-[#5F6C62]">
                      인용 후보, 관련 자료, 후속 검토 질문을 함께 표시해 최종 판단 전 확인해야 할 항목을 놓치지 않도록 구성합니다.
                    </p>
                  </div>
                  <div className="grid gap-2">
                    {[
                      ["01", "질문 범위 고정", "플랫폼과 업종을 먼저 고정합니다."],
                      ["02", "소재 문구 확인", "심사 리스크가 있는 표현을 분리합니다."],
                      ["03", "출처 대조", "답변 전 원문 일부와 인용 후보를 확인합니다."],
                    ].map(([step, title, description]) => (
                      <div key={step} className="grid grid-cols-[2.5rem_1fr] gap-3 rounded-lg border border-[#D8DCCF] bg-white p-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[#C6D9CB] bg-[#EDF7EF] text-[11px] font-semibold text-[#1F7A4D]">
                          {step}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#111713]">{title}</div>
                          <p className="mt-0.5 text-xs leading-5 text-[#5F6C62]">{description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
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
