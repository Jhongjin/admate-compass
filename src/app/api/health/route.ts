import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV,
      services: {} as any,
      responseTime: 0
    };

    // Ollama 서비스 상태 확인
    try {
      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const response = await fetch(`${ollamaUrl}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000) // 5초 타임아웃
      });

      if (response.ok) {
        const data = await response.json();
        health.services.ollama = {
          status: 'healthy',
          models: data.models?.length || 0,
          responseTime: Date.now() - startTime
        };
      } else {
        health.services.ollama = {
          status: 'unhealthy',
          error: `HTTP ${response.status}`
        };
      }
    } catch (error) {
      health.services.ollama = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error)
      };
    }

    // Supabase 연결 확인
    try {
      const { createClient } = await import('@supabase/supabase-js');
      
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        const { error } = await supabase
          .from('documents')
          .select('id')
          .limit(1);

        health.services.supabase = {
          status: error ? 'unhealthy' : 'healthy',
          error: error?.message
        };
      } else {
        health.services.supabase = {
          status: 'unhealthy',
          error: 'Environment variables not set'
        };
      }
    } catch (error) {
      health.services.supabase = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error)
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
    console.error('Health check failed:', error);
    
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      responseTime: Date.now() - startTime
    }, { status: 503 });
  }
}
