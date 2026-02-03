"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Send, Bot, User, ThumbsUp, ThumbsDown, History, FileText,
    MessageSquare, Clock, Settings, PanelRight, PanelLeft,
    ChevronRight, ChevronLeft, BookOpen, X, RefreshCw, Trash2,
    AlertTriangle, HelpCircle, Copy, Check, Menu, LayoutGrid, Star, CheckSquare
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

// GeminiProChatLayout - Testing Version
function GeminiProChatLayout() {
    // Mock user for testing design without login
    const mockUser = {
        id: "test-user",
        email: "test@example.com",
        user_metadata: { name: "Test User" }
    };

    const { toast } = useToast();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [rightPanelOpen, setRightPanelOpen] = useState(true);
    const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [isMobile, setIsMobile] = useState(false);
    const [rightPanelWidth, setRightPanelWidth] = useState(360);
    const [isDragging, setIsDragging] = useState(false);
    const [activeMenu, setActiveMenu] = useState<'history' | 'saved'>('history');
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const dragStartXRef = useRef<number>(0);
    const dragStartWidthRef = useRef<number>(0);

    // 초기 메시지 설정
    useEffect(() => {
        if (!isInitialized) {
            setMessages([
                {
                    id: "1",
                    type: "assistant",
                    content: "안녕하세요! 멀티 플랫폼 광고 FAQ AI 챗봇입니다. Meta, Naver, Kakao, Google, X 등 다양한 광고 플랫폼의 정책, 가이드라인, 설정 방법 등에 대해 궁금한 점이 있으시면 자유롭게 질문해주세요. (테스트 모드)",
                    timestamp: "방금 전",
                    sources: [],
                },
            ]);
            setIsInitialized(true);
        }
    }, [isInitialized]);

    // 모바일 감지
    useEffect(() => {
        if (typeof window === "undefined") return;
        const mediaQuery = window.matchMedia("(max-width: 1023px)");
        const handleMediaChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
        setIsMobile(mediaQuery.matches);
        if (typeof mediaQuery.addEventListener === "function") {
            mediaQuery.addEventListener("change", handleMediaChange);
            return () => mediaQuery.removeEventListener("change", handleMediaChange);
        }
    }, []);

    useEffect(() => {
        if (isMobile) {
            setRightPanelOpen(false);
        }
    }, [isMobile]);

    // 메시지 스크롤
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // 리사이징 로직
    const startResizing = useCallback((e: React.MouseEvent) => {
        setIsDragging(true);
        dragStartXRef.current = e.clientX;
        dragStartWidthRef.current = rightPanelWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [rightPanelWidth]);

    const stopResizing = useCallback(() => {
        setIsDragging(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, []);

    const resize = useCallback((e: MouseEvent) => {
        if (isDragging) {
            const deltaX = dragStartXRef.current - e.clientX;
            const newWidth = Math.max(280, Math.min(600, dragStartWidthRef.current + deltaX));
            setRightPanelWidth(newWidth);
        }
    }, [isDragging]);

    useEffect(() => {
        window.addEventListener('mousemove', resize);
        window.addEventListener('mouseup', stopResizing);
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [resize, stopResizing]);

    // Mock 메시지 전송 처리
    const handleSendMessage = useCallback(async () => {
        if (!inputValue.trim() || isLoading) return;

        const currentInput = inputValue.trim();
        setInputValue("");

        const userMessage: Message = {
            id: Date.now().toString(),
            type: "user",
            content: currentInput,
            timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        };

        setIsLoading(true);
        setMessages(prev => [...prev, userMessage]);

        // Simulate AI Response
        setTimeout(() => {
            const aiResponseId = (Date.now() + 1).toString();
            const aiResponse: Message = {
                id: aiResponseId,
                type: "assistant",
                content: `[테스트 응답] "${currentInput}"에 대한 답변입니다.\n\n이것은 디자인 테스트를 위한 모의 응답입니다. 실제 백엔드 연동 없이 UI/UX를 확인하실 수 있습니다.\n\n**주요 기능 확인:**\n- 그라데이션 메시지 버블\n- Glassmorphism 카드 디자인\n- 반응형 레이아웃\n- 애니메이션 효과`,
                timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                sources: [
                    { id: "s1", title: "Meta 광고 정책 가이드", excerpt: "광고 정책에 대한 상세 가이드입니다." },
                    { id: "s2", title: "Google Ads 도움말", excerpt: "Google Ads 설정 및 운영 방법." }
                ],
                feedback: { helpful: null, count: 0 },
                showContactOption: true
            };

            setMessages(prev => [...prev, aiResponse]);
            setIsLoading(false);
        }, 1500);

    }, [inputValue, isLoading]);

    // 새 대화 시작
    const handleNewChat = () => {
        setMessages([{
            id: "1",
            type: "assistant",
            content: "안녕하세요! 멀티 플랫폼 광고 FAQ AI 챗봇입니다. 새로운 대화가 시작되었습니다.",
            timestamp: "방금 전",
            sources: [],
        }]);
        setInputValue("");
    };

    // 메시지 복사
    const handleCopyMessage = (content: string, messageId: string) => {
        navigator.clipboard.writeText(content);
        setCopiedMessageId(messageId);
        setTimeout(() => setCopiedMessageId(null), 2000);
        toast({ title: "복사됨", description: "메시지가 클립보드에 복사되었습니다." });
    };

    // Selection Handlers
    const toggleSelectionMode = () => {
        setIsSelectionMode(!isSelectionMode);
        setSelectedItems(new Set());
    };

    const toggleItemSelection = (id: string) => {
        const newSelected = new Set(selectedItems);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedItems(newSelected);
    };

    const handleSelectAll = () => {
        if (selectedItems.size === mockHistoryItems.length) {
            setSelectedItems(new Set());
        } else {
            setSelectedItems(new Set(mockHistoryItems.map(item => item.id)));
        }
    };

    const handleDeleteSelected = () => {
        toast({ title: "삭제됨", description: `${selectedItems.size}개의 항목이 삭제되었습니다.` });
        setIsSelectionMode(false);
        setSelectedItems(new Set());
    };

    // Mock History Data
    const mockHistoryItems = [
        { id: "h1", title: "네이버 광고 정책 알려줘", date: "27분 전" },
        { id: "h2", title: "네이버 광고 알려줘", date: "1일 전" },
        { id: "h3", title: "네이버 광고 정책 알려줘", date: "1일 전" },
        { id: "h4", title: "네이버 광고에 대해 알려줘", date: "1일 전" },
        { id: "h5", title: "네이버 광고에 대해 알려줘", date: "1일 전" },
        { id: "h6", title: "메타 광고 알려줘", date: "1일 전" },
        { id: "h7", title: "메타 광고 알려줘", date: "2일 전" },
        { id: "h8", title: "네이버 광고 알려줘", date: "2일 전" },
    ];

    return (
        <div className="flex min-h-screen bg-[#0B0F17] text-white pt-[60px]" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
            {/* Header */}
            <nav
                className="fixed top-0 left-0 right-0 z-50 h-[60px] border-b border-white/5 bg-[#0B0F17]/80 backdrop-blur-md flex items-center justify-between transition-all duration-300 ease-in-out"
                style={{
                    paddingLeft: isLeftPanelCollapsed ? '88px' : '340px',
                    paddingRight: rightPanelOpen ? `${rightPanelWidth + 24}px` : '24px'
                }}
            >
                <div className="flex items-center gap-4">
                    <Image
                        src="/admate-logo.png"
                        alt="Admate Logo"
                        width={180}
                        height={48}
                        className="object-contain h-12 w-auto"
                    />
                    <div className="h-6 w-px bg-white/20" />
                    <h1 className="text-xl font-bold text-gray-200 tracking-tight">
                        멀티 광고 플랫폼 AI Agent
                    </h1>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white hover:bg-white/5">
                        <Settings className="w-5 h-5" />
                    </Button>
                    <div className="w-px h-4 bg-white/10 mx-1" />
                    <UserProfileDropdown user={mockUser} onSignOut={() => console.log("Sign out")} />
                </div>
            </nav>

            {/* Background Effects */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px] animate-pulse" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full blur-[120px] animate-pulse" />
            </div>

            {/* Left Panel - History (Full Height) */}
            <motion.div
                initial={{ width: 320 }}
                animate={{ width: isLeftPanelCollapsed ? 68 : 320 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="flex flex-col border-r border-white/5 bg-[#0B0F17] relative z-20 overflow-hidden flex-shrink-0 sticky top-[60px] h-[calc(100vh-60px)]"
            >
                {isLeftPanelCollapsed ? (
                    /* Collapsed State - Mini Sidebar */
                    <div className="flex flex-col items-center py-6 space-y-6 w-full">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsLeftPanelCollapsed(false)}
                            className="text-gray-400 hover:text-white"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleNewChat}
                            className="text-gray-400 hover:text-white"
                        >
                            <MessageSquare className="w-5 h-5" />
                        </Button>
                        <div className="w-8 h-px bg-white/10" />
                        <div className="flex flex-col gap-4 w-full items-center">
                            <button
                                onClick={() => setActiveMenu('history')}
                                className={`p-3 rounded-xl transition-all ${activeMenu === 'history'
                                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                    : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                            >
                                <History className="w-5 h-5" />
                            </button>
                            <button
                                onClick={() => setActiveMenu('saved')}
                                className={`p-3 rounded-xl transition-all ${activeMenu === 'saved'
                                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                    : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                            >
                                <BookOpen className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                ) : (
                    /* Expanded State - Full Sidebar */
                    <div className="p-4 space-y-6 pt-6 min-w-[320px]">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex flex-col">
                                <span className="text-xs text-gray-400 font-medium mb-1">대화 목록</span>
                                <h2 className="text-xl font-bold text-white">최근 문의 내역</h2>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setIsLeftPanelCollapsed(true)}
                                className="text-gray-400 hover:text-white"
                            >
                                <PanelLeft className="w-5 h-5" />
                            </Button>
                        </div>

                        <Button
                            onClick={handleNewChat}
                            className="w-full bg-[#1A1F2B] hover:bg-[#2A3040] text-white border border-white/10 justify-start px-4 py-6 text-base font-medium"
                        >
                            <MessageSquare className="w-5 h-5 mr-3 text-gray-400" />
                            새 대화하기
                        </Button>

                        <div className="flex flex-col gap-1">
                            <button
                                onClick={() => setActiveMenu('history')}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeMenu === 'history'
                                    ? 'bg-white text-black'
                                    : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'}`}
                            >
                                <History className="w-5 h-5" />
                                히스토리
                            </button>
                            <button
                                onClick={() => setActiveMenu('saved')}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeMenu === 'saved'
                                    ? 'bg-white text-black'
                                    : 'text-gray-400 hover:text-gray-300 hover:bg-white/5'}`}
                            >
                                <BookOpen className="w-5 h-5" />
                                저장된 답변
                            </button>
                        </div>

                        <div className="space-y-4 pt-4 border-t border-white/5">
                            <div className="flex items-center justify-between px-2">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-full bg-[#1A1F2B] text-blue-400">
                                        <History className="w-5 h-5" />
                                    </div>
                                    <div className="flex flex-col">
                                        <h3 className="text-base font-bold text-white">대화 히스토리</h3>
                                        <span className="text-xs text-gray-500">최근 대화 기록</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1">
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10" onClick={toggleSelectionMode}>
                                        <CheckSquare className="w-4 h-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10">
                                        <ChevronLeft className="w-4 h-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10">
                                        <MessageSquare className="w-4 h-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10">
                                        <RefreshCw className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>

                            {isSelectionMode && (
                                <div className="flex items-center justify-between bg-[#131720] p-2 rounded-lg border border-white/5 mx-2">
                                    <button
                                        onClick={handleSelectAll}
                                        className="text-xs text-blue-400 hover:text-blue-300 font-medium px-2"
                                    >
                                        {selectedItems.size === mockHistoryItems.length ? '전체 해제' : '전체 선택'}
                                    </button>
                                    <span className="text-xs text-gray-400">{selectedItems.size}개 선택됨</span>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:bg-red-500/10" onClick={handleDeleteSelected}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            )}

                            <div className="space-y-1 max-h-[calc(100vh-400px)] overflow-y-auto custom-scrollbar pr-2">
                                {mockHistoryItems.map((item) => (
                                    <div
                                        key={item.id}
                                        className={`group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${isSelectionMode && selectedItems.has(item.id)
                                            ? 'bg-blue-500/10 border-blue-500/30'
                                            : 'border-transparent hover:bg-[#1A1F2B] hover:border-white/5'
                                            }`}
                                        onMouseEnter={() => setHoveredItemId(item.id)}
                                        onMouseLeave={() => setHoveredItemId(null)}
                                        onClick={() => isSelectionMode && toggleItemSelection(item.id)}
                                    >
                                        {isSelectionMode ? (
                                            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${selectedItems.has(item.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-600'
                                                }`}>
                                                {selectedItems.has(item.id) && <Check className="w-3 h-3 text-white" />}
                                            </div>
                                        ) : (
                                            <MessageSquare className="w-4 h-4 text-gray-500 group-hover:text-gray-400" />
                                        )}

                                        <div className="flex-1 min-w-0 flex items-center justify-between">
                                            <p className={`text-sm truncate max-w-[140px] ${isSelectionMode && selectedItems.has(item.id) ? 'text-blue-100' : 'text-gray-300 group-hover:text-white'}`}>
                                                {item.title}
                                            </p>
                                            <span className="text-xs text-gray-600 group-hover:text-gray-500 whitespace-nowrap">{item.date}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </motion.div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 relative">

                {/* Center Panel - Chat */}
                <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar relative scroll-smooth bg-[#0B0F17] rounded-tl-3xl border-l border-t border-white/10 ml-2 mt-2">
                    <div className="max-w-4xl mx-auto w-full space-y-6 pr-[10%]">
                        {messages.map((message) => (
                            <motion.div
                                key={message.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
                            >
                                <div className={`max-w-[80%] ${message.type === "user" ? "ml-auto" : "mr-auto"}`}>
                                    <div className={`relative p-6 rounded-2xl backdrop-blur-md ${message.type === "user"
                                        ? "bg-gradient-to-br from-blue-600/20 to-cyan-600/20 border border-blue-400/20"
                                        : "bg-white/5 border border-white/10"
                                        }`}>
                                        <div className="flex items-start gap-3">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${message.type === "user" ? "bg-blue-500/20" : "bg-purple-500/20"
                                                }`}>
                                                {message.type === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                                            </div>
                                            <div className="flex-1">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                    className="prose prose-invert prose-sm max-w-none"
                                                >
                                                    {message.content}
                                                </ReactMarkdown>

                                                {/* Sources in Chat Bubble */}
                                                {message.type === "assistant" && message.sources && message.sources.length > 0 && (
                                                    <div className="mt-4 pt-4 border-t border-white/10">
                                                        <div className="text-xs font-semibold text-gray-400 mb-2">출처</div>
                                                        <div className="space-y-1">
                                                            {message.sources.map((source) => (
                                                                <div key={source.id} className="flex items-center gap-2 text-xs text-blue-400 hover:underline cursor-pointer">
                                                                    <FileText className="w-3 h-3" />
                                                                    {source.title}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Contact Support Banner */}
                                                {message.type === "assistant" && message.showContactOption && (
                                                    <div className="mt-6 p-4 rounded-xl bg-[#1A1F2E] border border-blue-500/30">
                                                        <div className="flex items-start gap-3">
                                                            <div className="p-2 rounded-lg bg-blue-500/20">
                                                                <AlertTriangle className="w-5 h-5 text-blue-400" />
                                                            </div>
                                                            <div className="flex-1">
                                                                <div className="text-sm font-semibold text-gray-200 mb-1">추가 상담 필요 시</div>
                                                                <div className="text-lg font-bold text-white mb-1">벤더 담당팀에게 바로 연결해드릴까요?</div>
                                                                <p className="text-xs text-gray-400 mb-3">보다 구체적인 정책 확인이나 빠른 승인 검토가 필요하면 담당팀이 직접 도와드립니다.</p>

                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                                                        <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                                                                        상담 가능 시간: 평일 09:00 - 18:00
                                                                    </div>
                                                                    <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white border-none">
                                                                        <MessageSquare className="w-4 h-4 mr-2" />
                                                                        담당팀에 문의하기
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="flex items-center justify-between mt-4 pt-2 border-t border-white/5">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-xs text-gray-500">{message.timestamp}</span>
                                                        {message.type === "assistant" && (
                                                            <span className="text-[10px] text-gray-500">챗봇 답변에 대한 만족도를 평가해주세요. 품질개선에 큰 도움이 됩니다.</span>
                                                        )}
                                                    </div>
                                                    {message.type === "assistant" && (
                                                        <div className="flex items-center gap-1">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => handleCopyMessage(message.content, message.id)}
                                                                className="h-7 w-7 p-0 text-gray-400 hover:text-white"
                                                            >
                                                                {copiedMessageId === message.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                                            </Button>
                                                            <div className="w-px h-3 bg-white/10 mx-1" />
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-7 w-7 p-0 text-gray-400 hover:text-white"
                                                            >
                                                                <ThumbsUp className="w-3.5 h-3.5" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-7 w-7 p-0 text-gray-400 hover:text-white"
                                                            >
                                                                <ThumbsDown className="w-3.5 h-3.5" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                        {isLoading && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                                <div className="bg-white/5 border border-white/10 p-4 rounded-2xl flex items-center gap-2">
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0s" }} />
                                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
                                    <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "0.4s" }} />
                                </div>
                            </motion.div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                </div>

                {/* Chat Input */}
                <div className="border-t border-white/5 bg-[#0B0F17]/80 backdrop-blur-md p-6">
                    <div className="max-w-4xl mx-auto pr-[10%]">
                        <div className="relative">
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
                                placeholder="질문을 입력하세요..."
                                className="w-full min-h-[60px] max-h-[200px] bg-white/5 border-white/10 rounded-2xl pr-12 resize-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20"
                                disabled={isLoading}
                            />
                            <Button
                                onClick={handleSendMessage}
                                disabled={!inputValue.trim() || isLoading}
                                className="absolute right-2 bottom-2 h-10 w-10 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                            >
                                <Send className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg border border-white/10">
                                <RefreshCw className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Panel */}
            < AnimatePresence mode="wait" >
                {rightPanelOpen && (
                    <motion.div
                        initial={{ x: "100%", opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: "100%", opacity: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="fixed top-0 right-0 bottom-0 z-[60] h-screen shadow-2xl bg-[#F8F9FC] rounded-l-3xl"
                        style={{ width: rightPanelWidth }}
                    >
                        {/* Resize Handle */}
                        <div
                            className="absolute left-0 top-0 bottom-0 w-4 -ml-2 cursor-col-resize z-50 flex items-center justify-center group"
                            onMouseDown={startResizing}
                        >
                            <div className={`w-1 h-8 rounded-full transition-colors ${isDragging ? 'bg-blue-500' : 'bg-gray-600/30 group-hover:bg-blue-400/50'}`} />
                        </div>

                        {/* Collapse Button - Improved Position */}
                        <div className="absolute -left-10 top-1/2 -translate-y-1/2 z-30">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setRightPanelOpen(false)}
                                className="h-8 w-8 rounded-full bg-[#1A1F2B] border border-white/10 text-gray-400 hover:text-white hover:bg-[#2A3040] shadow-lg"
                            >
                                <PanelRight className="w-4 h-4" />
                            </Button>
                        </div>

                        {/* Panel Content - Bright Point Style */}
                        <div className="flex-1 h-full bg-[#F8F9FC] border-l border-gray-200 overflow-hidden flex flex-col">
                            <div className="p-6 border-b border-gray-200 bg-white pt-8">
                                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                    <BookOpen className="w-5 h-5 text-blue-600" />
                                    관련 자료
                                </h3>
                            </div>

                            <div className="p-4 h-full overflow-y-auto custom-scrollbar bg-[#F8F9FC]">
                                <div className="space-y-6">

                                    {/* Section 1: Key Summary (Detailed) */}
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2">
                                            <div className="p-1 rounded bg-blue-100">
                                                <Star className="w-4 h-4 text-blue-600" />
                                            </div>
                                            <span className="text-sm font-bold text-gray-800">답변 핵심 요약</span>
                                            <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 rounded-full">AI 분석</Badge>
                                        </div>

                                        <div className="p-5 rounded-2xl bg-white border border-gray-200 shadow-sm space-y-5">
                                            {/* Key Points Subsection */}
                                            <div className="space-y-3">
                                                <div className="flex items-center gap-2">
                                                    <Check className="w-4 h-4 text-green-500" />
                                                    <span className="text-xs font-bold text-gray-700">주요 포인트</span>
                                                    <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 text-[10px] px-2 py-0.5">신뢰도 85%</Badge>
                                                </div>
                                                <ul className="space-y-2.5">
                                                    <li className="flex items-start gap-2.5 text-xs text-gray-600 leading-relaxed">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                                                        <span>네이버는 2020년부터 다양한 광고 상품들을 지속적으로 업데이트하고 있음</span>
                                                    </li>
                                                    <li className="flex items-start gap-2.5 text-xs text-gray-600 leading-relaxed">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                                                        <span>웹툰 쿠키오븐, 뉴스 본문 중간 디스플레이 광고 등 새로운 광고 상품 추가</span>
                                                    </li>
                                                    <li className="flex items-start gap-2.5 text-xs text-gray-600 leading-relaxed">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                                                        <span>정확한 최신 광고 정책은 네이버 광고 고객센터에 직접 문의 필요</span>
                                                    </li>
                                                </ul>
                                            </div>

                                            {/* Reference Content Subsection */}
                                            <div className="space-y-3 pt-4 border-t border-gray-100">
                                                <div className="flex items-center gap-2">
                                                    <BookOpen className="w-4 h-4 text-purple-500" />
                                                    <span className="text-xs font-bold text-gray-700">참고 문서 핵심 내용</span>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="p-3 rounded-xl bg-purple-50/50 border border-purple-100">
                                                        <div className="flex items-start gap-2.5">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1.5 flex-shrink-0" />
                                                            <span className="text-xs text-gray-600 leading-relaxed">2020년 초 다양한 광고 상품 업데이트 진행</span>
                                                        </div>
                                                    </div>
                                                    <div className="p-3 rounded-xl bg-purple-50/50 border border-purple-100">
                                                        <div className="flex items-start gap-2.5">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1.5 flex-shrink-0" />
                                                            <span className="text-xs text-gray-600 leading-relaxed">스페셜 DA 제작 가이드 및 메인 브랜딩 DA 예시 이미지 수정</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Section 2: Related Questions */}
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="p-1 rounded bg-purple-100">
                                                <HelpCircle className="w-4 h-4 text-purple-600" />
                                            </div>
                                            <span className="text-sm font-bold text-gray-800">관련 질문 예측</span>
                                        </div>
                                        <div className="space-y-2">
                                            {["최근 변경된 의료 광고 가이드라인은?", "텍스트 오버레이 검사 도구 바로가기", "광고 계정 비활성화 시 해결 방법"].map((q, i) => (
                                                <button key={i} className="w-full text-left p-3 rounded-xl bg-white border border-gray-200 hover:border-purple-300 hover:shadow-md transition-all group">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs font-medium text-gray-700 group-hover:text-purple-700">{q}</span>
                                                        <ChevronRight className="w-3 h-3 text-gray-400 group-hover:text-purple-500" />
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Section 3: Additional Learning */}
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="p-1 rounded bg-green-100">
                                                <BookOpen className="w-4 h-4 text-green-600" />
                                            </div>
                                            <span className="text-sm font-bold text-gray-800">추가 학습 자료</span>
                                            <Badge variant="secondary" className="bg-green-100 text-green-700 text-[10px] px-1.5 py-0">추천</Badge>
                                        </div>
                                        <div className="space-y-3">
                                            <div className="p-3 rounded-xl bg-white border border-gray-200 hover:border-green-300 transition-all cursor-pointer">
                                                <div className="flex items-start gap-3">
                                                    <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                                                        <Image src="/admate-logo.png" alt="Doc" width={20} height={20} className="opacity-50" />
                                                    </div>
                                                    <div>
                                                        <div className="text-xs font-bold text-gray-800 mb-1">네이버 광고 집행 가이드</div>
                                                        <div className="text-[10px] text-gray-500 mb-2">네이버 공식 비즈니스 스쿨 • 15분 소요</div>
                                                        <div className="flex items-center gap-1 text-[10px] text-green-600 font-medium">
                                                            학습하기 <ChevronRight className="w-3 h-3" />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="p-3 rounded-xl bg-white border border-gray-200 hover:border-green-300 transition-all cursor-pointer">
                                                <div className="flex items-start gap-3">
                                                    <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                                                        <FileText className="w-5 h-5 text-gray-400" />
                                                    </div>
                                                    <div>
                                                        <div className="text-xs font-bold text-gray-800 mb-1">2024 광고 정책 변경점 총정리</div>
                                                        <div className="text-[10px] text-gray-500 mb-2">AdMate 인사이트 • PDF 다운로드</div>
                                                        <div className="flex items-center gap-1 text-[10px] text-green-600 font-medium">
                                                            보기 <ChevronRight className="w-3 h-3" />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                </div>
                            </div>
                        </div>
                    </motion.div >
                )
                }
            </AnimatePresence >

            {/* Re-open Button for Right Panel (When Closed) */}
            {
                !rightPanelOpen && !isMobile && (
                    <div className="fixed top-1/2 right-0 -translate-y-1/2 z-40">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setRightPanelOpen(true)}
                            className="h-12 w-6 rounded-l-xl bg-[#1A1F2B] border-y border-l border-white/10 text-gray-400 hover:text-white hover:bg-[#2A3040] shadow-lg flex items-center justify-center"
                        >
                            <PanelLeft className="w-4 h-4" />
                        </Button>
                    </div>
                )
            }
        </div >
    );
}

export default GeminiProChatLayout;
