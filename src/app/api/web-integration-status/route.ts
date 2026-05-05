import { NextRequest, NextResponse } from 'next/server';
import { checkOllamaHealth } from '@/lib/services/ollama';
import { getOllamaEndpointStatus } from '@/lib/services/ollamaEndpoint';

export async function GET() {
  try {
    console.log('🔍 웹 통합 서비스 상태 확인 시작');
    
    // Ollama 서버 상태 확인
    const ollamaHealthy = await checkOllamaHealth();
    
    // 환경 변수 상태 확인
    const envStatus = {
      ollama: {
        ...getOllamaEndpointStatus(),
        defaultModelConfigured: !!process.env.OLLAMA_DEFAULT_MODEL
      },
      gemini: {
        apiKey: !!process.env.GEMINI_API_KEY,
        googleApiKey: !!process.env.GOOGLE_API_KEY,
        model: process.env.GOOGLE_MODEL || 'gemini-1.5-flash',
        configured: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
      },
      supabase: {
        url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        serviceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        configured: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
      }
    };
    
    // 서비스 상태 계산 (Vultr+Ollama 전용)
    const services = {
      ollama: {
        status: ollamaHealthy ? 'healthy' : 'unhealthy',
        priority: 'primary',
        description: '주 LLM 모델 (Vultr + Ollama)'
      },
      rag: {
        status: envStatus.supabase.configured ? 'ready' : 'not_configured',
        priority: 'support',
        description: '문서 검색 시스템 (Supabase + pgvector)'
      }
    };
    
    // 전체 상태 계산 (Vultr+Ollama 전용)
    const overallStatus = ollamaHealthy ? 'operational' : 'critical';
    
    const statusInfo = {
      overall: {
        status: overallStatus,
        message: overallStatus === 'operational' ? 
          'Vultr+Ollama 전용 서비스가 정상적으로 작동 중입니다.' :
          'Vultr+Ollama 서비스에 문제가 발생했습니다.'
      },
      services,
      environment: envStatus,
      timestamp: new Date().toISOString(),
      version: 'web-integration-v1.0'
    };
    
    console.log('✅ 웹 통합 서비스 상태 확인 완료:', {
      overallStatus,
      ollamaHealthy,
      geminiConfigured: envStatus.gemini.configured,
      supabaseConfigured: envStatus.supabase.configured
    });
    
    return NextResponse.json(statusInfo, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    
  } catch (error) {
    console.error('❌ 웹 통합 서비스 상태 확인 실패:', error);
    
    return NextResponse.json({
      overall: {
        status: 'error',
        message: '서비스 상태 확인 중 오류가 발생했습니다.'
      },
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }, {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}
