"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { History, MessageSquare, RefreshCw, Trash2, ChevronLeft, ChevronRight, CheckSquare, Square, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";

interface Conversation {
  id: string;
  recordId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  isFavorite: boolean;
  // handleLoadConversation에서 필요한 추가 필드들
  user_message?: string;
  ai_response?: string;
  sources?: any[];
  conversation_id?: string;
}

interface HistoryPanelProps {
  onLoadConversation?: (conversation: Conversation) => void;
  onNewChat?: () => void;
  userId?: string;
  className?: string;
  isCollapsed?: boolean;
  onToggle?: () => void;
  refreshTrigger?: number; // 새로고침 트리거
  theme?: {
    bgSidebar?: string;
    bgMain?: string;
    border?: string;
    textPrimary?: string;
    textSecondary?: string;
    accent?: string;
  };
  enableBulkActions?: boolean;
  filterMode?: "all" | "history" | "saved";
  panelTitle?: string;
  panelDescription?: string;
  emptyStateMessage?: {
    title: string;
    description: string;
  };
  onFavoritesUpdated?: () => void;
}

export default function HistoryPanel({ 
  onLoadConversation, 
  onNewChat,
  userId = "anonymous",
  className = "",
  isCollapsed = false,
  onToggle,
  refreshTrigger,
  theme,
  enableBulkActions = true,
  filterMode = "all",
  panelTitle,
  panelDescription,
  emptyStateMessage,
  onFavoritesUpdated,
}: HistoryPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedConversations, setSelectedConversations] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [favoriteLoadingIds, setFavoriteLoadingIds] = useState<Set<string>>(new Set());

  // 대화 히스토리 로드
  const loadConversations = useCallback(async () => {
    // anonymous 사용자는 히스토리를 로드하지 않음
    if (userId === "anonymous" || !userId) {
      setConversations([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/conversations?userId=${encodeURIComponent(userId)}`);
      if (!response.ok) {
        throw new Error('대화 히스토리를 불러올 수 없습니다.');
      }
      
      const data = await response.json();
      
      // API 응답을 HistoryPanel 형식에 맞게 변환
      const formattedConversations = (data.conversations || []).map((conv: any) => ({
        id: conv.conversation_id || conv.id,
        recordId: conv.id,
        title: conv.user_message || conv.title || '대화',
        createdAt: conv.created_at,
        updatedAt: conv.created_at,
        messageCount: 1,
        isFavorite: Boolean(conv.is_favorite),
        // handleLoadConversation에서 필요한 원본 데이터 보존
        user_message: conv.user_message,
        ai_response: conv.ai_response,
        sources: conv.sources || [],
        conversation_id: conv.conversation_id || conv.id,
      }));
      
      setConversations(formattedConversations);
    } catch (err) {
      console.error('대화 히스토리 로드 실패:', err);
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
      setConversations([]);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // 대화 삭제
  const handleDeleteConversation = async (conversationId: string) => {
    // anonymous 사용자는 삭제할 수 없음
    if (userId === "anonymous" || !userId) {
      return;
    }

    try {
      const response = await fetch(`/api/conversations?conversationId=${conversationId}&userId=${encodeURIComponent(userId)}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        // 삭제 성공 시 목록에서 제거
        setConversations(prev => prev.filter(conv => conv.id !== conversationId));
      }
    } catch (err) {
      console.error('대화 삭제 실패:', err);
    }
  };

  // 컴포넌트 마운트 시 대화 히스토리 로드
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // refreshTrigger가 변경될 때마다 대화 히스토리 새로고침
  useEffect(() => {
    if (refreshTrigger !== undefined) {
      loadConversations();
    }
  }, [refreshTrigger, loadConversations]);

  // 전체선택 관련 함수들
  const handleSelectAll = () => {
    if (selectedConversations.size === conversations.length) {
      // 모두 선택된 상태면 모두 해제
      setSelectedConversations(new Set());
    } else {
      // 모두 선택
      setSelectedConversations(new Set(conversations.map(conv => conv.id)));
    }
  };

  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversations(prev => {
      const newSet = new Set(prev);
      if (newSet.has(conversationId)) {
        newSet.delete(conversationId);
      } else {
        newSet.add(conversationId);
      }
      return newSet;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedConversations.size === 0) return;

    setIsDeleting(true);
    setDeletingIds(new Set(selectedConversations));
    
    try {
      // 선택된 대화들을 하나씩 삭제
      const deletePromises = Array.from(selectedConversations).map(async (conversationId) => {
        const response = await fetch(`/api/conversations?conversationId=${conversationId}&userId=${encodeURIComponent(userId)}`, {
          method: 'DELETE'
        });
        return response.ok;
      });

      const results = await Promise.all(deletePromises);
      const successCount = results.filter(Boolean).length;

      if (successCount > 0) {
        // 성공한 대화들을 목록에서 제거
        setConversations(prev => prev.filter(conv => !selectedConversations.has(conv.id)));
        setSelectedConversations(new Set());
        setIsSelectMode(false);
      }
    } catch (err) {
      console.error('선택된 대화 삭제 실패:', err);
    } finally {
      setIsDeleting(false);
      setDeletingIds(new Set());
    }
  };

  const handleCancelSelect = () => {
    setSelectedConversations(new Set());
    setIsSelectMode(false);
  };

  const handleToggleFavorite = async (conversation: Conversation) => {
    if (!conversation.recordId) return;

    const willSave = !conversation.isFavorite;
    setConversations(prev =>
      prev.map(conv =>
        conv.id === conversation.id
          ? { ...conv, isFavorite: willSave }
          : conv
      )
    );

    setFavoriteLoadingIds(prev => {
      const next = new Set(prev);
      next.add(conversation.recordId as string);
      return next;
    });

    try {
      const response = await fetch(`/api/conversations/${conversation.recordId}/favorite`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_favorite: willSave }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }
      onFavoritesUpdated?.();
    } catch (error) {
      console.error('즐겨찾기 API 오류:', error);
      // rollback
      setConversations(prev =>
        prev.map(conv =>
          conv.id === conversation.id
            ? { ...conv, isFavorite: !willSave }
            : conv
        )
      );
    } finally {
      setFavoriteLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(conversation.recordId as string);
        return next;
      });
    }
  };

  const filteredConversations = useMemo(() => {
    if (filterMode === "saved") {
      return conversations.filter((conv) => conv.isFavorite);
    }
    return conversations;
  }, [conversations, filterMode]);

  const currentPanelTitle = panelTitle ?? (filterMode === "saved" ? "저장된 답변" : "대화 히스토리");
  const defaultDescription = `${filteredConversations.length}개`;
  const currentPanelDescription = panelDescription ?? defaultDescription;
  const emptyState = emptyStateMessage ?? (filterMode === "saved"
    ? {
        title: "저장된 답변이 없습니다",
        description: "히스토리에서 별 아이콘을 눌러 답변을 저장해보세요.",
      }
    : {
        title: userId === "anonymous" ? "로그인이 필요합니다" : "대화 히스토리가 없습니다",
        description:
          userId === "anonymous"
            ? "대화 히스토리를 보려면 로그인해주세요"
            : "새로운 대화를 시작해보세요",
      });

  const selectionModeActive = enableBulkActions && isSelectMode;

  if (isCollapsed) {
    return (
      <div className={`h-full bg-white border-r border-gray-200 flex flex-col ${className}`}>
        {/* 접힌 상태 - 토글 버튼만 표시 */}
        <div className="p-2 border-b border-gray-200 bg-white">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className="w-full h-8 p-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
            <History className="w-4 h-4 text-gray-600" />
          </div>
        </div>
      </div>
    );
  }

  const bgColor = theme?.bgSidebar || 'bg-white';
  const borderColor = theme?.border || 'border-gray-200';
  const textPrimary = theme?.textPrimary || 'text-gray-900';
  const textSecondary = theme?.textSecondary || 'text-gray-500';
  
  return (
    <div 
      className={`h-full flex flex-col ${className}`}
      style={{ 
        backgroundColor: theme?.bgSidebar || '#ffffff',
        borderColor: theme?.border || '#e5e7eb',
        color: theme?.textPrimary || '#111827'
      }}
    >
      {/* 헤더 */}
      <div 
        className="p-4 border-b flex-shrink-0"
        style={{ 
          borderColor: theme?.border || '#e5e7eb',
          backgroundColor: theme?.bgSidebar || '#ffffff'
        }}
      >
        {!selectionModeActive ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div 
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: theme?.accent ? `${theme.accent}20` : '#f3f4f6' }}
              >
                <History 
                  className="w-5 h-5" 
                  style={{ color: theme?.accent || '#6b7280' }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <h3 
                  className="text-sm font-semibold whitespace-nowrap"
                  style={{ color: theme?.textPrimary || '#111827' }}
                >
                  {currentPanelTitle}
                </h3>
                <span 
                  className="text-xs"
                  style={{ color: theme?.textSecondary || '#6b7280' }}
                >
                  {currentPanelDescription}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-wrap justify-end">
              {enableBulkActions && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsSelectMode(true)}
                  className="h-8 w-8 p-0 border transition-colors flex items-center justify-center"
                  title="전체선택 모드"
                  style={{ 
                    color: theme?.textSecondary || '#6b7280',
                    borderColor: theme?.border || '#e5e7eb',
                  }}
                >
                  <CheckSquare className="w-5 h-5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggle}
                className="h-8 w-8 p-0 transition-colors flex items-center justify-center"
                style={{ 
                  color: theme?.textSecondary || '#6b7280',
                }}
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onNewChat}
                className="h-8 w-8 p-0 transition-colors flex items-center justify-center"
                style={{ 
                  color: theme?.textSecondary || '#6b7280',
                }}
              >
                <MessageSquare className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadConversations}
                disabled={isLoading}
                className="h-8 w-8 p-0 transition-colors flex items-center justify-center"
                style={{ 
                  color: theme?.textSecondary || '#6b7280',
                }}
                title="새로고침"
              >
                <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
                className="h-8 w-8 p-0 border transition-colors"
                title={selectedConversations.size === conversations.length ? "전체 해제" : "전체 선택"}
                style={{ 
                  color: theme?.textSecondary || '#6b7280',
                  borderColor: theme?.border || '#e5e7eb',
                }}
              >
                {selectedConversations.size === conversations.length ? (
                  <CheckSquare className="w-5 h-5" />
                ) : (
                  <Square className="w-5 h-5" />
                )}
              </Button>
              <div>
                <h3 className="text-sm font-semibold text-blue-700">선택 모드</h3>
                <span className="text-xs text-blue-600 font-medium">
                  {selectedConversations.size}개 선택됨
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteSelected}
                disabled={selectedConversations.size === 0 || isDeleting}
                className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 border border-red-200 hover:border-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                title="선택된 항목 삭제"
              >
                <Trash2 className={`w-5 h-5 ${isDeleting ? 'animate-pulse' : ''}`} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancelSelect}
                className="h-8 w-8 p-0 border transition-colors"
                title="선택 취소"
                style={{ 
                  color: theme?.textSecondary || '#6b7280',
                  borderColor: theme?.border || '#e5e7eb',
                }}
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 콘텐츠 영역 */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center space-y-3">
              <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
              <span className="text-xs text-gray-500">불러오는 중...</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-8 px-4">
            <div className="flex flex-col items-center space-y-3 text-center">
              <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                <History className="w-4 h-4 text-red-500" />
              </div>
              <span className="text-xs text-red-600">{error}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={loadConversations}
                className="text-xs h-7 px-2 text-gray-600 border-gray-300 hover:bg-gray-50"
              >
                다시 시도
              </Button>
            </div>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="flex items-center justify-center py-8 px-4">
            <div className="flex flex-col items-center space-y-3 text-center">
              <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-gray-500" />
              </div>
              {userId === "anonymous" || !userId ? (
                <>
                  <h4 className="text-xs font-medium text-gray-700">로그인이 필요합니다</h4>
                  <p className="text-xs text-gray-500">대화 히스토리를 보려면 로그인해주세요</p>
                </>
              ) : (
                <>
                  <h4 className="text-xs font-medium text-gray-700">대화 히스토리가 없습니다</h4>
                  <p className="text-xs text-gray-500">새로운 대화를 시작해보세요</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onNewChat}
                    className="text-xs h-7 px-2 text-gray-600 border-gray-300 hover:bg-gray-50"
                  >
                    새 대화 시작
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto chat-scrollbar">
            <div className="p-2">
              <AnimatePresence>
                {filteredConversations.map((conversation, index) => (
                  <motion.div
                    key={conversation.id}
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.95 }}
                    transition={{ 
                      duration: 0.3, 
                      delay: index * 0.05,
                      ease: "easeOut"
                    }}
                    whileHover={{ 
                      scale: 1.02,
                      transition: { duration: 0.2 }
                    }}
                    whileTap={{ scale: 0.98 }}
                    className={`group p-3 rounded-lg transition-all duration-200 border-b last:border-b-0 ${
                      isSelectMode 
                        ? 'cursor-default' 
                        : 'cursor-pointer'
                    }`}
                    style={{
                      borderColor: theme?.border || '#f3f4f6',
                      backgroundColor: selectedConversations.has(conversation.id) 
                        ? (theme?.accent ? `${theme.accent}20` : '#dbeafe')
                        : 'transparent',
                      color: theme?.textPrimary || '#111827',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelectMode && !selectedConversations.has(conversation.id)) {
                        e.currentTarget.style.backgroundColor = theme?.bgMain ? `${theme.bgMain}80` : '#f9fafb';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelectMode && !selectedConversations.has(conversation.id)) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                    onClick={() => {
                      if (isSelectMode) {
                        handleSelectConversation(conversation.id);
                      } else {
                        onLoadConversation?.(conversation);
                      }
                    }}
                  >
                  <div className="flex items-center space-x-3">
                    {isSelectMode ? (
                      <div className="flex-shrink-0">
                        {deletingIds.has(conversation.id) ? (
                          <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
                        ) : (
                          <Checkbox
                            checked={selectedConversations.has(conversation.id)}
                            onChange={() => handleSelectConversation(conversation.id)}
                            className="h-4 w-4 border-2 border-gray-300 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500 hover:border-blue-400 hover:bg-blue-50 transition-colors duration-200"
                          />
                        )}
                      </div>
                    ) : (
                      <div 
                        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: theme?.bgMain ? `${theme.bgMain}80` : '#f3f4f6' }}
                      >
                        <MessageSquare 
                          className="w-3 h-3" 
                          style={{ color: theme?.textSecondary || '#6b7280' }}
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0 flex items-center">
                          <span 
                            className="text-[12px] font-medium truncate"
                            style={{ color: theme?.textPrimary || '#111827' }}
                          >
                            {conversation.title.length > 18 
                              ? `${conversation.title.substring(0, 18)}...` 
                              : conversation.title}
                          </span>
                          <span 
                            className="text-[10px] ml-2 flex-shrink-0"
                            style={{ color: theme?.textSecondary || '#6b7280' }}
                          >
                            {formatDistanceToNow(new Date(conversation.updatedAt), {
                              addSuffix: true,
                              locale: ko
                            })}
                          </span>
                        </div>
                        {!isSelectMode && (
                          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleFavorite(conversation);
                              }}
                              disabled={favoriteLoadingIds.has(conversation.recordId || conversation.id)}
                              className={`h-5 w-5 p-0 ${conversation.isFavorite ? 'text-yellow-400' : 'text-gray-400'} hover:text-yellow-400`}
                              title={conversation.isFavorite ? "저장 해제" : "저장"}
                            >
                              <Star className="w-3 h-3" fill={conversation.isFavorite ? "currentColor" : "none"} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteConversation(conversation.id);
                              }}
                              className="h-5 w-5 p-0 text-gray-400 hover:text-red-500 hover:bg-red-50"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
