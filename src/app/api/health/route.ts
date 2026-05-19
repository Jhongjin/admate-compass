import { NextRequest, NextResponse } from 'next/server';
import { createCompassServiceClient } from '@/lib/supabase/compass';
import { resolveOllamaEndpoint } from '@/lib/services/ollamaEndpoint';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {} as any,
      responseTime: 0
    };

    // Answer runtime status. Public JSON stays provider-neutral.
    try {
      const endpoint = resolveOllamaEndpoint();
      if (!endpoint.baseUrl) {
        health.services.answerRuntime = {
          status: 'unhealthy',
          configured: false,
          managed: true,
          reachable: false
        };
        throw new Error('answer_runtime_health_recorded');
      }

      const response = await fetch(`${endpoint.baseUrl}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000) // 5초 타임아웃
      });

      if (response.ok) {
        health.services.answerRuntime = {
          status: 'healthy',
          configured: true,
          managed: true,
          reachable: true
        };
      } else {
        health.services.answerRuntime = {
          status: 'unhealthy',
          configured: true,
          managed: true,
          reachable: false
        };
      }
    } catch (error) {
      if (!(error instanceof Error && error.message === 'answer_runtime_health_recorded')) {
        health.services.answerRuntime = {
          status: 'unhealthy',
          configured: false,
          managed: true,
          reachable: false
        };
      }
    }

    // Supabase 연결 확인
    try {
      const dbUrlConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (dbUrlConfigured && supabaseKey) {
        const supabase = createCompassServiceClient();
        const { error } = await supabase
          .from('documents')
          .select('id')
          .limit(1);

        health.services.documentStore = {
          status: error ? 'unhealthy' : 'healthy'
        };
      } else {
        health.services.documentStore = {
          status: 'unhealthy'
        };
      }
    } catch (error) {
      health.services.documentStore = {
        status: 'unhealthy'
      };
    }

    // 전체 상태 결정
    const allServicesHealthy = Object.values(health.services).every(
      (service: any) => service.status === 'healthy'
    );

    if (!allServicesHealthy) {
      health.status = 'degraded';
    }

    const responseTime = Date.now() - startTime;
    health.responseTime = responseTime;

    return NextResponse.json(health, {
      status: allServicesHealthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });

  } catch (error) {
    console.error('Health check failed:', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'health_check_failed',
      responseTime: Date.now() - startTime
    }, { status: 503 });
  }
}
