"use client";

import { useState, useEffect } from 'react';

interface FeedbackStats {
  total: number;
  positive: number;
  negative: number;
  positivePercentage: number;
  dailyStats: Array<{
    date: string;
    total: number;
    positive: number;
    negative: number;
  }>;
  recentFeedback: Array<{
    id: number;
    user_id: string;
    conversation_id: string;
    message_id: string;
    helpful: boolean;
    created_at: string;
    conversations: {
      user_message: string;
      ai_response: string;
    };
  }>;
}

export function useFeedbackStats(period: string = '7') {
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/feedback/stats?period=${period}`);
      if (!response.ok) {
        throw new Error('피드백 통계를 불러올 수 없습니다.');
      }
      
      const data = await response.json();
      if (data.success) {
        setStats(data.stats);
      } else {
        throw new Error(data.error || '피드백 통계를 불러올 수 없습니다.');
      }
    } catch (err) {
      console.error('피드백 통계 로드 실패:', err);
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
      // 에러 발생 시 기본값 설정
      setStats({
        total: 0,
        positive: 0,
        negative: 0,
        positivePercentage: 0,
        dailyStats: [],
        recentFeedback: []
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [period]);

  return {
    stats,
    isLoading,
    error,
    refetch: fetchStats
  };
}
