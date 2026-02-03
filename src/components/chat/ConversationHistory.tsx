"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  History, 
  Clock, 
  MessageSquare, 
  Trash2, 
  ChevronRight,
  Loader2,
  AlertCircle,
  RefreshCw,
  FileText
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";

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
      const response = await fetch(`/api/conversations?userId=${userId}&limit=20`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '대화 히스토리를 불러오는 중 오류가 발생했습니다.');
      }
      
      setConversations(data.conversations || []);
    } catch (error) {
      console.error('대화 히스토리 로드 오류:', error);
      setError(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (!userId) return;
    
    setDeletingId(conversationId);
    
    try {
      const response = await fetch(`/api/conversations?conversationId=${conversationId}&userId=${userId}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '대화를 삭제하는 중 오류가 발생했습니다.');
      }
      
      setConversations(prev => prev.filter(conv => conv.conversation_id !== conversationId));
      onDeleteConversation?.(conversationId);
    } catch (error) {
      console.error('대화 삭제 오류:', error);
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
    <Card className="w-full bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm border-gray-700/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center space-x-2 text-white text-sm font-medium">
          <History className="w-4 h-4" />
          <span>대화 히스토리</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center py-6">
          <div className="text-center">
            <MessageSquare className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-300">로그인 후 대화 히스토리를 확인할 수 있습니다.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
  }

  return (
    <Card className="w-full bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm border-gray-700/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <History className="w-4 h-4 text-orange-400" />
            <span className="text-white text-sm font-medium">대화 히스토리</span>
            <Badge variant="secondary" className="text-xs bg-orange-500/20 text-orange-300 border-orange-500/30">
              {conversations.length}개
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadConversations}
            disabled={loading}
            className="h-8 w-8 p-0 text-gray-400 hover:text-white hover:bg-gray-700/50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </CardTitle>
        <Separator className="bg-gray-700/50" />
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="flex items-center space-x-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg backdrop-blur-sm">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-sm text-red-300">{error}</span>
          </div>
        )}
        
        {loading && conversations.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center space-y-3">
              <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
              <span className="text-sm text-gray-300">대화 히스토리를 불러오는 중...</span>
            </div>
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-8">
            <div className="flex flex-col items-center space-y-3">
              <div className="p-3 bg-gray-700/50 rounded-full">
                <MessageSquare className="w-8 h-8 text-gray-400" />
              </div>
              <div>
                <p className="text-sm text-gray-300 font-medium">아직 대화 히스토리가 없습니다</p>
                <p className="text-xs text-gray-400 mt-1">AI 챗봇과 대화를 시작해보세요!</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto chat-scrollbar">
            {conversations.map((conversation) => (
              <Card
                key={conversation.id}
                className="group bg-gradient-to-r from-gray-800/60 to-gray-700/60 border-gray-600/30 hover:from-gray-700/70 hover:to-gray-600/70 transition-all duration-200 cursor-pointer backdrop-blur-sm shadow-sm hover:shadow-md"
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start space-x-2">
                        <div className="p-1.5 bg-orange-500/20 rounded-full mt-0.5">
                          <FileText className="w-3 h-3 text-orange-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate leading-relaxed">
                            {conversation.user_message}
                          </p>
                          <div className="flex items-center space-x-2 mt-2">
                            <div className="flex items-center text-xs text-gray-400 bg-gray-700/50 px-2 py-1 rounded-full">
                              <Clock className="w-3 h-3 mr-1" />
                              {formatDistanceToNow(new Date(conversation.created_at), { 
                                addSuffix: true, 
                                locale: ko 
                              })}
                            </div>
                            {conversation.sources && conversation.sources.length > 0 && (
                              <Badge variant="outline" className="text-xs bg-blue-500/20 text-blue-300 border-blue-500/30">
                                출처 {conversation.sources.length}개
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onLoadConversation?.(conversation)}
                        className="h-8 w-8 p-0 text-gray-300 hover:text-white hover:bg-orange-500/20"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteConversation(conversation.conversation_id)}
                        disabled={deletingId === conversation.conversation_id}
                        className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/20"
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