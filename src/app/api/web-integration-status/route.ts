import { NextRequest, NextResponse } from 'next/server';
import { checkOllamaHealth } from '@/lib/services/ollama';
import { getOllamaEndpointStatus } from '@/lib/services/ollamaEndpoint';
import { getCompassAnswerRuntimeStatus } from '@/lib/services/CompassAnswerLlmService';

export async function GET() {
  try {
    console.log('🔍 웹 통합 서비스 상태 확인 시작');
    
    const answerRuntime = getCompassAnswerRuntimeStatus();
    const ollamaHealthy = answerRuntime.provider === 'ollama' ? await checkOllamaHealth() : false;
    const answerReady = answerRuntime.provider === 'openrouter'
      ? answerRuntime.openrouterConfigured
      : ollamaHealthy;
    const ollamaEndpointStatus = getOllamaEndpointStatus();
    
    // 환경 변수 상태 확인
    const envStatus = {
      answer: {
        provider: answerRuntime.provider,
        modelLabel: answerRuntime.modelLabel,
        configured: answerReady
      },
      openrouter: {
        configured: answerRuntime.openrouterConfigured,
        modelsConfigured: !!(process.env.COMPASS_ANSWER_MODELS || process.env.COMPASS_ANSWER_MODEL)
      },
      ollama: {
        ...ollamaEndpointStatus,
        baseUrl: ollamaEndpointStatus.source,
        defaultModel: process.env.OLLAMA_DEFAULT_MODEL || process.env.OLLAMA_MODEL || 'mistral:7b',
        defaultModelConfigured: !!process.env.OLLAMA_DEFAULT_MODEL
      },
      supabase: {
        url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        serviceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        configured: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
      }
    };
    
    // 서비스 상태 계산
    const services = {
      answer: {
        status: answerReady ? (answerRuntime.provider === 'openrouter' ? 'ready' : 'healthy') : 'not_configured',
        priority: 'primary',
        description: `답변 LLM 런타임 (${answerRuntime.provider})`
      },
      rag: {
        status: envStatus.supabase.configured ? 'ready' : 'not_configured',
        priority: 'support',
        description: '문서 검색 시스템 (Supabase + pgvector)'
      }
    };
    
    // 전체 상태 계산
    const overallStatus = answerReady && envStatus.supabase.configured ? 'operational' : 'critical';
    
    const statusInfo = {
      overall: {
        status: overallStatus,
        message: overallStatus === 'operational' ? 
          'Compass 답변 LLM과 RAG 서비스가 정상적으로 작동 중입니다.' :
          'Compass 답변 LLM 또는 RAG 설정을 확인해야 합니다.'
      },
      services,
      environment: envStatus,
      timestamp: new Date().toISOString(),
      version: 'web-integration-v1.0'
    };
    
    console.log('✅ 웹 통합 서비스 상태 확인 완료:', {
      overallStatus,
      answerProvider: answerRuntime.provider,
      answerReady,
      ollamaHealthy,
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
