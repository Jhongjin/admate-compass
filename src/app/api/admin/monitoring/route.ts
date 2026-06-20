import { NextRequest, NextResponse } from 'next/server';
import { createCompassServiceClient } from '@/lib/supabase/compass';
import { guardCompassProductAdminSessionRoute } from '@/lib/adminProductSessionGuard';
import { getCompassAnswerRuntimeMetrics } from '@/lib/server/compassAnswerHandler';

// 환경 변수 확인 및 조건부 클라이언트 생성
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: any = null;

if (supabaseUrl && supabaseKey) {
  supabase = createCompassServiceClient();
}

export interface SystemMetrics {
  timestamp: string;
  cpu: {
    usage: number;
    cores: number;
    load: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usage: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
  };
  database: {
    connections: number;
    queries: number;
    responseTime: number;
  };
  vectorStore: {
    totalVectors: number;
    indexSize: number;
    queryTime: number;
  };
}

export interface SystemLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
  details?: any;
}

export interface MonitoringData {
  systemStatus: {
    overall: 'healthy' | 'warning' | 'error';
    database: 'connected' | 'disconnected' | 'error';
    llm: 'operational' | 'degraded' | 'error';
    vectorStore: 'indexed' | 'indexing' | 'error';
    lastUpdate: string;
  };
  metrics: SystemMetrics;
  recentLogs: SystemLog[];
  alerts: Array<{
    id: string;
    type: 'warning' | 'error' | 'info';
    title: string;
    message: string;
    timestamp: string;
    resolved: boolean;
  }>;
  performance: {
    avgResponseTime: number;
    requestsPerMinute: number;
    errorRate: number;
    uptime: number;
    answerRuntime: ReturnType<typeof getCompassAnswerRuntimeMetrics>;
  };
}

export async function GET(request: NextRequest) {
    const sessionGuard = guardCompassProductAdminSessionRoute(request);
    if (sessionGuard) return sessionGuard;

    // Supabase 클라이언트 확인
    if (!supabase) {
      return NextResponse.json(
        { error: '데이터베이스 연결이 설정되지 않았습니다.' },
        { status: 500 }
      );
    }
  try {
    console.log('🚀 시스템 모니터링 API 시작...');

    const { searchParams } = new URL(request.url);
    const timeRange = searchParams.get('timeRange') || '1h';
    const logLevel = searchParams.get('logLevel') || 'all';

    // 1. 시스템 상태 확인
    const systemStatus = await getSystemStatus();

    // 2. 성능 메트릭 수집
    const metrics = await getSystemMetrics();

    // 3. 최근 로그 조회
    const recentLogs = await getRecentLogs(timeRange, logLevel);

    // 4. 알림 조회
    const alerts = await getAlerts();

    // 5. 성능 통계
    const performance = await getPerformanceStats();

    const monitoringData: MonitoringData = {
      systemStatus,
      metrics,
      recentLogs,
      alerts,
      performance
    };

    console.log('📊 시스템 모니터링 데이터 수집 완료');

    return NextResponse.json({
      success: true,
      data: monitoringData
    });

  } catch (error) {
    console.error('❌ 시스템 모니터링 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '시스템 모니터링 데이터 조회 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}

async function getSystemStatus() {
  try {
    // 데이터베이스 연결 상태 확인
    const { data: dbTest, error: dbError } = await supabase
      .from('documents')
      .select('id')
      .limit(1);

    const databaseStatus = dbError ? 'error' : 'connected';

    // 문서 상태 확인
    const { data: documents } = await supabase
      .from('documents')
      .select('status');

    const errorCount = documents?.filter((doc: any) =>
      doc.status === 'error' || doc.status === 'failed'
    ).length || 0;

    const processingCount = documents?.filter((doc: any) =>
      doc.status === 'processing' || doc.status === 'indexing'
    ).length || 0;

    let overallStatus: 'healthy' | 'warning' | 'error' = 'healthy';
    if (databaseStatus === 'error' || errorCount > 0) {
      overallStatus = 'error';
    } else if (processingCount > 0) {
      overallStatus = 'warning';
    }

    return {
      overall: overallStatus,
      database: databaseStatus as 'connected' | 'disconnected' | 'error',
      llm: 'operational' as 'operational' | 'degraded' | 'error',
      vectorStore: processingCount > 0 ? 'indexing' as 'indexing' : 'indexed' as 'indexed',
      lastUpdate: new Date().toISOString()
    };
  } catch (error) {
    console.error('시스템 상태 확인 오류:', error);
    return {
      overall: 'error' as const,
      database: 'error' as const,
      llm: 'error' as const,
      vectorStore: 'error' as const,
      lastUpdate: new Date().toISOString()
    };
  }
}

async function getSystemMetrics(): Promise<SystemMetrics> {
  // 실제 환경에서는 시스템 메트릭을 수집하는 서비스와 연동
  // 현재는 시뮬레이션된 데이터 반환
  const now = new Date();

  return {
    timestamp: now.toISOString(),
    cpu: {
      usage: Math.random() * 30 + 20, // 20-50%
      cores: 4,
      load: [0.5, 0.3, 0.2, 0.1]
    },
    memory: {
      total: 8 * 1024 * 1024 * 1024, // 8GB
      used: Math.random() * 4 * 1024 * 1024 * 1024 + 2 * 1024 * 1024 * 1024, // 2-6GB
      free: 0,
      usage: 0
    },
    disk: {
      total: 100 * 1024 * 1024 * 1024, // 100GB
      used: Math.random() * 50 * 1024 * 1024 * 1024 + 20 * 1024 * 1024 * 1024, // 20-70GB
      free: 0,
      usage: 0
    },
    network: {
      bytesIn: Math.random() * 1000000,
      bytesOut: Math.random() * 500000,
      packetsIn: Math.floor(Math.random() * 1000),
      packetsOut: Math.floor(Math.random() * 500)
    },
    database: {
      connections: Math.floor(Math.random() * 20) + 5,
      queries: Math.floor(Math.random() * 100) + 50,
      responseTime: Math.random() * 50 + 10
    },
    vectorStore: {
      totalVectors: Math.floor(Math.random() * 10000) + 5000,
      indexSize: Math.random() * 500 * 1024 * 1024 + 100 * 1024 * 1024, // 100-600MB
      queryTime: Math.random() * 20 + 5
    }
  };
}

async function getRecentLogs(timeRange: string, logLevel: string): Promise<SystemLog[]> {
  // 실제 환경에서는 로그 시스템과 연동
  // 현재는 시뮬레이션된 로그 데이터 반환
  const logs: SystemLog[] = [
    {
      id: '1',
      timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      level: 'info',
      source: 'document-processor',
      message: '문서 처리 완료: example.pdf',
      details: { documentId: 'doc-123', processingTime: 2500 }
    },
    {
      id: '2',
      timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
      level: 'warn',
      source: 'vector-store',
      message: '벡터 인덱싱 지연 감지',
      details: { delay: 5000, documentId: 'doc-456' }
    },
    {
      id: '3',
      timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
      level: 'info',
      source: 'api',
      message: '사용자 질문 처리: "광고 정책은 어떻게 되나요?"',
      details: { userId: 'user-789', responseTime: 1200 }
    },
    {
      id: '4',
      timestamp: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
      level: 'error',
      source: 'crawler',
      message: 'URL 크롤링 실패: https://example.com',
      details: { error: 'Connection timeout', retryCount: 3 }
    },
    {
      id: '5',
      timestamp: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
      level: 'info',
      source: 'auth',
      message: '사용자 로그인: admin@example.com',
      details: { ip: '192.168.1.100', userAgent: 'Mozilla/5.0...' }
    }
  ];

  // 로그 레벨 필터링
  if (logLevel !== 'all') {
    return logs.filter(log => log.level === logLevel);
  }

  return logs;
}

async function getAlerts() {
  return [
    {
      id: 'alert-1',
      type: 'warning' as const,
      title: '높은 메모리 사용률',
      message: '메모리 사용률이 80%를 초과했습니다.',
      timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      resolved: false
    },
    {
      id: 'alert-2',
      type: 'error' as const,
      title: '데이터베이스 연결 오류',
      message: 'Supabase 연결에 일시적인 문제가 발생했습니다.',
      timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
      resolved: true
    },
    {
      id: 'alert-3',
      type: 'info' as const,
      title: '시스템 업데이트 완료',
      message: 'v1.2.0 업데이트가 성공적으로 완료되었습니다.',
      timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      resolved: true
    }
  ];
}

async function getPerformanceStats() {
  return {
    avgResponseTime: Math.random() * 100 + 50, // 50-150ms
    requestsPerMinute: Math.floor(Math.random() * 100) + 50, // 50-150
    errorRate: Math.random() * 2, // 0-2%
    uptime: Math.floor(Math.random() * 86400) + 3600, // 1-24시간 (초)
    answerRuntime: getCompassAnswerRuntimeMetrics()
  };
}


