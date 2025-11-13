'use client';

export interface DashboardStats {
  totalDocuments: number;
  completedDocuments: number;
  pendingDocuments: number;
  processingDocuments: number;
  totalChunks: number;
  totalEmbeddings: number;
  systemStatus: {
    overall: 'healthy' | 'warning' | 'error';
    database: 'connected' | 'disconnected' | 'error';
    llm: 'operational' | 'degraded' | 'error';
    vectorStore: 'indexed' | 'indexing' | 'error';
    lastUpdate: string;
  };
  recentActivity: Array<{
    id: string;
    type: 'question' | 'document_upload' | 'feedback' | 'system';
    content: string;
    time: string;
    user?: string;
  }>;
  performanceMetrics: Array<{
    metric: string;
    value: string;
    status: 'excellent' | 'good' | 'warning' | 'error';
    trend: string;
  }>;
  weeklyStats: {
    questions: number;
    users: number;
    satisfaction: number;
    documents: number;
  };
  teamStats: Array<{
    team: string;
    user_count: number;
    new_users_30d: number;
    new_users_7d: number;
    first_user_created: string;
    last_user_created: string;
  }>;
  teamQuestionStats: Array<{
    team: string;
    question_count: number;
    questions_30d: number;
    questions_7d: number;
    avg_response_time: number | null;
  }>;
  systemInfo?: {
    databaseSize: string;
    indexedDocuments: number;
    activeUsers: number;
    progressMetrics: {
      overall: number;
      database: number;
      llm: number;
      vectorStore: number;
    };
  };
  apiUsage?: {
    claude: {
      totalRequests: number;
      totalTokens: number;
      totalCost: number;
    };
    gpt: {
      totalRequests: number;
      totalTokens: number;
      totalCost: number;
    };
    total: {
      totalRequests: number;
      totalTokens: number;
      totalCost: number;
    };
  } | null;
}

export class DashboardDataService {
  private baseUrl = '/api/admin';

  /**
   * 대시보드 통계 데이터 조회
   */
  async getDashboardStats(): Promise<DashboardStats> {
    try {
      const response = await fetch(`${this.baseUrl}/dashboard`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || '대시보드 데이터 조회에 실패했습니다.');
      }

      // 기본값과 병합하여 안전하게 처리
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
        recentActivity: [],
        performanceMetrics: [],
        weeklyStats: {
          questions: 0,
          users: 0,
          satisfaction: 0,
          documents: 0
        },
        ...data.data
      };
    } catch (error) {
      console.error('대시보드 데이터 조회 오류:', error);
      // 오류 발생 시 기본값 반환
      return {
        totalDocuments: 0,
        completedDocuments: 0,
        pendingDocuments: 0,
        processingDocuments: 0,
        totalChunks: 0,
        totalEmbeddings: 0,
        systemStatus: {
          overall: 'error' as const,
          database: 'disconnected' as const,
          llm: 'error' as const,
          vectorStore: 'error' as const,
          lastUpdate: '알 수 없음'
        },
        recentActivity: [],
        performanceMetrics: [],
        weeklyStats: {
          questions: 0,
          users: 0,
          satisfaction: 0,
          documents: 0
        },
        teamStats: [],
        teamQuestionStats: []
      };
    }
  }


  /**
   * 실시간 데이터 새로고침
   */
  async refreshDashboardStats(): Promise<DashboardStats> {
    return this.getDashboardStats();
  }
}

// 싱글톤 인스턴스
export const dashboardDataService = new DashboardDataService();
