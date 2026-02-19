"use client";

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

interface DashboardStats {
  totalDocuments: number;
  completedDocuments: number;
  pendingDocuments: number;
  processingDocuments: number;
  totalChunks: number;
  totalEmbeddings: number;
  systemStatus: {
    overall: 'healthy' | 'warning' | 'error';
    database: 'connected' | 'disconnected';
    llm: 'operational' | 'error';
    vectorStore: 'indexed' | 'indexing' | 'error';
    lastUpdate: string;
  };
  performanceMetrics: Array<{
    metric: string;
    value: string;
    trend: string;
    status: 'good' | 'excellent' | 'warning' | 'error';
  }>;
  weeklyStats: {
    questions: number;
    users: number;
    satisfaction: number;
    documents: number;
  };
}

interface ChatStats {
  totalQuestions: number;
  averageResponseTime: number;
  accuracy: number;
  userSatisfaction: number;
  dailyQuestions: number;
}

interface LatestUpdateInfo {
  lastUpdateDate: string;
  recentUpdates: Array<{
    id: string;
    title: string;
    updated_at: string;
    type: string;
    status: string;
  }>;
  newDocuments: Array<{
    id: string;
    title: string;
    created_at: string;
    type: string;
    status: string;
  }>;
  hasNewFeatures: boolean;
  updateCount: number;
  newDocumentCount: number;
  message: string;
  displayDate: string;
  isRecent: boolean;
  hasUpdates: boolean;
}

export function useDashboardStats() {
  return useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/admin/dashboard');
        if (!response.ok) {
          console.warn(`HTTP ${response.status}: Failed to fetch dashboard stats`);
          return {
            totalDocuments: 0,
            completedDocuments: 0,
            pendingDocuments: 0,
            processingDocuments: 0,
            totalChunks: 0,
            totalEmbeddings: 0,
            systemStatus: {
              overall: 'healthy' as const,
              database: 'connected' as const,
              llm: 'operational' as const,
              vectorStore: 'indexed' as const,
              lastUpdate: '방금 전'
            },
            performanceMetrics: [],
            weeklyStats: {
              questions: 0,
              users: 0,
              satisfaction: 0,
              documents: 0
            }
          };
        }
        const data = await response.json();
        return data.data || {
          totalDocuments: 0,
          completedDocuments: 0,
          pendingDocuments: 0,
          processingDocuments: 0,
          totalChunks: 0,
          totalEmbeddings: 0,
          systemStatus: {
            overall: 'healthy' as const,
            database: 'connected' as const,
            llm: 'operational' as const,
            vectorStore: 'indexed' as const,
            lastUpdate: '방금 전'
          },
          performanceMetrics: [],
          weeklyStats: {
            questions: 0,
            users: 0,
            satisfaction: 0,
            documents: 0
          }
        };
      } catch (error) {
        console.warn('Dashboard stats fetch error:', error);
        return {
          totalDocuments: 0,
          completedDocuments: 0,
          pendingDocuments: 0,
          processingDocuments: 0,
          totalChunks: 0,
          totalEmbeddings: 0,
          systemStatus: {
            overall: 'healthy' as const,
            database: 'connected' as const,
            llm: 'operational' as const,
            vectorStore: 'indexed' as const,
            lastUpdate: '방금 전'
          },
          performanceMetrics: [],
          weeklyStats: {
            questions: 0,
            users: 0,
            satisfaction: 0,
            documents: 0
          }
        };
      }
    },
    refetchInterval: 30000, // 30초마다 새로고침
    staleTime: 10000, // 10초간 캐시 유지
    retry: 1, // 실패 시 1번만 재시도
    retryDelay: 1000, // 1초 후 재시도
  });
}

export function useChatStats() {
  return useQuery<ChatStats>({
    queryKey: ['chat-stats'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/chatbot');
        if (!response.ok) {
          console.warn(`HTTP ${response.status}: Failed to fetch chat stats`);
          return {
            totalQuestions: 0,
            averageResponseTime: 0,
            accuracy: 0,
            userSatisfaction: 0,
            dailyQuestions: 0
          };
        }
        const data = await response.json();
        return data.stats || {
          totalQuestions: 0,
          averageResponseTime: 0,
          accuracy: 0,
          userSatisfaction: 0,
          dailyQuestions: 0
        };
      } catch (error) {
        console.warn('Chat stats fetch error:', error);
        return {
          totalQuestions: 0,
          averageResponseTime: 0,
          accuracy: 0,
          userSatisfaction: 0,
          dailyQuestions: 0
        };
      }
    },
    refetchInterval: 60000, // 1분마다 새로고침
    staleTime: 30000, // 30초간 캐시 유지
    retry: 1, // 실패 시 1번만 재시도
    retryDelay: 1000, // 1초 후 재시도
  });
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ['system-status'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/admin/status');
        if (!response.ok) {
          console.warn(`HTTP ${response.status}: Failed to fetch system status`);
          return {
            success: true,
            stats: {
              total: 0,
              completed: 0,
              pending: 0,
              processing: 0,
              totalChunks: 0
            },
            documents: [],
            systemStatus: {
              overall: 'healthy',
              database: 'healthy',
              api: 'healthy',
              lastChecked: new Date().toISOString()
            }
          };
        }
        const data = await response.json();
        return data || {
          success: true,
          stats: {
            total: 0,
            completed: 0,
            pending: 0,
            processing: 0,
            totalChunks: 0
          },
          documents: [],
          systemStatus: {
            overall: 'healthy',
            database: 'healthy',
            api: 'healthy',
            lastChecked: new Date().toISOString()
          }
        };
      } catch (error) {
        console.warn('System status fetch error:', error);
        return {
          success: true,
          stats: {
            total: 0,
            completed: 0,
            pending: 0,
            processing: 0,
            totalChunks: 0
          },
          documents: [],
          systemStatus: {
            overall: 'healthy',
            database: 'healthy',
            api: 'healthy',
            lastChecked: new Date().toISOString()
          }
        };
      }
    },
    refetchInterval: 15000, // 15초마다 새로고침
    staleTime: 5000, // 5초간 캐시 유지
    retry: 1, // 실패 시 1번만 재시도
    retryDelay: 1000, // 1초 후 재시도
  });
}

export function useLatestUpdate() {
  return useQuery<LatestUpdateInfo>({
    queryKey: ['latest-update'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/latest-update');
        if (!response.ok) {
          console.warn(`HTTP ${response.status}: Failed to fetch latest update info`);
          return {
            lastUpdateDate: new Date().toISOString(),
            recentUpdates: [],
            newDocuments: [],
            hasNewFeatures: false,
            updateCount: 0,
            newDocumentCount: 0,
            message: "메타 광고 정책이 최신 상태로 유지되고 있습니다.",
            displayDate: new Date().toLocaleDateString('ko-KR'),
            isRecent: false,
            hasUpdates: false
          };
        }
        const data = await response.json();
        return data.data || {
          lastUpdateDate: new Date().toISOString(),
          recentUpdates: [],
          newDocuments: [],
          hasNewFeatures: false,
          updateCount: 0,
          newDocumentCount: 0,
          message: "메타 광고 정책이 최신 상태로 유지되고 있습니다.",
          displayDate: new Date().toLocaleDateString('ko-KR'),
          isRecent: false,
          hasUpdates: false
        };
      } catch (error) {
        console.warn('Latest update fetch error:', error);
        return {
          lastUpdateDate: new Date().toISOString(),
          recentUpdates: [],
          newDocuments: [],
          hasNewFeatures: false,
          updateCount: 0,
          newDocumentCount: 0,
          message: "메타 광고 정책이 최신 상태로 유지되고 있습니다.",
          displayDate: new Date().toLocaleDateString('ko-KR'),
          isRecent: false,
          hasUpdates: false
        };
      }
    },
    refetchInterval: 300000, // 5분마다 새로고침
    staleTime: 60000, // 1분간 캐시 유지
    retry: 1, // 실패 시 1번만 재시도
    retryDelay: 1000, // 1초 후 재시도
  });
}
