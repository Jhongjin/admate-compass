"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  History, 
  Clock, 
  Trash2, 
  ChevronRight,
  Loader2,
  AlertCircle,
  RefreshCw,
  FileText
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import {
  COMPASS_CONVERSATION_HISTORY_LIMIT,
  deleteCompassLocalConversation,
  loadCompassLocalConversations,
} from "@/lib/client/compassLocalHistory";

interface Conversation {
  id: string;
  conversation_id: string;
  user_message: string;
  ai_response: string;
  sources: any[];
  created_at: string;
}

interface ConversationHistoryProps {
  userId?: string;
  onLoadConversation?: (conversation: Conversation) => void;
  onDeleteConversation?: (conversationId: string) => void;
}

export default function ConversationHistory({ 
  userId, 
  onLoadConversation, 
  onDeleteConversation 
}: ConversationHistoryProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadConversations = async () => {
    if (!userId) {
      setError("로그인이 필요합니다.");
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/conversations?limit=${COMPASS_CONVERSATION_HISTORY_LIMIT}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '검토 기록을 불러오는 중 오류가 발생했습니다.');
      }
      
      const remoteConversations = data.conversations || [];
      const localConversations = loadCompassLocalConversations(userId);
      const seenIds = new Set<string>();
      const merged = [...remoteConversations, ...localConversations]
        .filter((conversation) => {
          const key = conversation.conversation_id || conversation.id;
          if (seenIds.has(key)) return false;
          seenIds.add(key);
          return true;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, COMPASS_CONVERSATION_HISTORY_LIMIT);

      setConversations(merged);
    } catch (error) {
      console.error('검토 기록 로드 오류:', error);
      setError(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
      setConversations(loadCompassLocalConversations(userId).slice(0, COMPASS_CONVERSATION_HISTORY_LIMIT));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (!userId) return;
    
    setDeletingId(conversationId);
    
    try {
      const response = await fetch(`/api/conversations?conversationId=${encodeURIComponent(conversationId)}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '검토 기록을 삭제하는 중 오류가 발생했습니다.');
      }
      
      deleteCompassLocalConversation(userId, conversationId);
      setConversations(prev => prev.filter(conv => conv.conversation_id !== conversationId));
      onDeleteConversation?.(conversationId);
    } catch (error) {
      console.error('검토 기록 삭제 오류:', error);
      deleteCompassLocalConversation(userId, conversationId);
      setConversations(prev => prev.filter(conv => conv.conversation_id !== conversationId));
      setError(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    loadConversations();
  }, [userId]);

  if (!userId) {
      return (
    <Card className="w-full overflow-hidden rounded-lg border-[#D6D8CD] bg-white shadow-sm">
      <div className="h-1 bg-[#1F7A4D]" />
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center space-x-2 text-sm font-medium text-[#111713]">
          <History className="h-4 w-4 text-[#1F7A4D]" />
          <span>검토 기록</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center py-6">
          <div className="text-center">
            <FileText className="mx-auto mb-2 h-8 w-8 text-[#8A9388]" />
            <p className="text-sm text-[#5F6C62]">로그인 후 정책 검토 기록을 확인할 수 있습니다.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
  }

  return (
    <Card className="w-full overflow-hidden rounded-lg border-[#D6D8CD] bg-white shadow-sm">
      <div className="h-1 bg-[#1F7A4D]" />
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <History className="h-4 w-4 text-[#1F7A4D]" />
            <span className="text-sm font-medium text-[#111713]">최근 검토 기록</span>
            <Badge variant="secondary" className="border-[#C6D9CB] bg-[#EDF7EF] text-xs text-[#1F7A4D]">
              {conversations.length}개
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadConversations}
            disabled={loading}
            className="h-8 w-8 rounded-md p-0 text-[#5F6C62] hover:bg-[#EDF7EF] hover:text-[#111713]"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </CardTitle>
        <Separator className="bg-[#D8DCCF]" />
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="flex items-center space-x-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <span className="text-sm text-red-700">{error}</span>
          </div>
        )}
        
        {loading && conversations.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center space-y-3">
              <Loader2 className="h-6 w-6 animate-spin text-[#1F7A4D]" />
              <span className="text-sm text-[#5F6C62]">검토 기록 장부를 불러오는 중...</span>
              <div className="w-44 space-y-1.5">
                <div className="h-2 rounded-full bg-[#E6E9DF]" />
                <div className="h-2 w-2/3 rounded-full bg-[#E6E9DF]" />
              </div>
            </div>
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-8">
            <div className="flex flex-col items-center space-y-3">
              <div className="rounded-lg border border-[#D8DCCF] bg-[#FBFBF7] p-3">
                <FileText className="h-8 w-8 text-[#8A9388]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#34423A]">아직 검토 기록이 없습니다</p>
                <p className="mt-1 text-xs text-[#5F6C62]">정책 항목, 플랫폼명, 소재 표현을 함께 남기면 이후 인용 검토가 쉬워집니다.</p>
              </div>
              <div className="grid w-full gap-2 pt-1 text-left text-xs text-[#5F6C62]">
                <div className="rounded-md border border-[#D8DCCF] bg-white px-3 py-2">
                  기록 기준: 질문, 응답, 연결된 근거 문서
                </div>
                <div className="rounded-md border border-[#D8DCCF] bg-white px-3 py-2">
                  검토 흐름: 최근 사례를 다시 열어 정책 표현을 비교
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
            {conversations.map((conversation) => (
              <Card
                key={conversation.id}
                className="group cursor-pointer rounded-lg border-[#D8DCCF] bg-[#FBFBF7] shadow-sm transition-colors duration-200 hover:border-[#B9C9BB] hover:bg-white"
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start space-x-2">
                        <div className="mt-0.5 rounded-md border border-[#C6D9CB] bg-[#EDF7EF] p-1.5">
                          <FileText className="h-3 w-3 text-[#1F7A4D]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-medium leading-relaxed text-[#111713]">
                            {conversation.user_message}
                          </p>
                          <div className="flex items-center space-x-2 mt-2">
                            <div className="flex items-center rounded-md border border-[#D8DCCF] bg-white px-2 py-1 text-xs text-[#5F6C62]">
                              <Clock className="mr-1 h-3 w-3" />
                              {formatDistanceToNow(new Date(conversation.created_at), { 
                                addSuffix: true, 
                                locale: ko 
                              })}
                            </div>
                            {conversation.sources && conversation.sources.length > 0 && (
                              <Badge variant="outline" className="border-[#C6D9CB] bg-[#EDF7EF] text-xs text-[#1F7A4D]">
                                근거 {conversation.sources.length}개
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="ml-2 flex items-center space-x-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onLoadConversation?.(conversation)}
                        className="h-8 w-8 rounded-md p-0 text-[#5F6C62] hover:bg-[#EDF7EF] hover:text-[#111713]"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteConversation(conversation.conversation_id)}
                        disabled={deletingId === conversation.conversation_id}
                        className="h-8 w-8 rounded-md p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        {deletingId === conversation.conversation_id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
