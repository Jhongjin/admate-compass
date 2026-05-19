import { NextResponse } from 'next/server';
import { checkOllamaHealth } from '@/lib/services/ollama';
import { getCompassAnswerRuntimeStatus } from '@/lib/services/CompassAnswerLlmService';

export async function GET() {
  try {
    console.log('🔍 웹 통합 서비스 상태 확인 시작');
    
    const answerRuntime = getCompassAnswerRuntimeStatus();
    const managedRuntimeReady = answerRuntime.provider === 'ollama' ? await checkOllamaHealth() : false;
    const answerReady = answerRuntime.provider === 'openrouter'
      ? answerRuntime.openrouterConfigured
      : managedRuntimeReady;
    const documentStoreReady = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    // 환경 변수 상태 확인
    const envStatus = {
      answerRuntime: {
        configured: answerReady,
        mode: 'managed'
      },
      documentStore: {
        configured: documentStoreReady
      }
    };
    
    // 서비스 상태 계산
    const services = {
      answer: {
        status: answerReady ? 'ready' : 'not_configured',
        priority: 'primary',
        description: 'Compass 답변 런타임'
      },
      rag: {
        status: envStatus.documentStore.configured ? 'ready' : 'not_configured',
        priority: 'support',
        description: '문서 검색 시스템'
      }
    };
    
    // 전체 상태 계산
    const overallStatus = answerReady && envStatus.documentStore.configured ? 'operational' : 'critical';
    
    const statusInfo = {
      overall: {
        status: overallStatus,
        message: overallStatus === 'operational' ? 
          'Compass 답변 런타임과 문서 검색 서비스가 정상적으로 작동 중입니다.' :
          'Compass 답변 런타임 또는 문서 검색 설정을 확인해야 합니다.'
      },
      services,
      environment: envStatus,
      timestamp: new Date().toISOString(),
      version: 'web-integration-v1.0'
    };
    
    console.log('✅ 웹 통합 서비스 상태 확인 완료:', {
      overallStatus,
      answerReady,
      runtimeConfigured: envStatus.answerRuntime.configured,
      documentStoreConfigured: envStatus.documentStore.configured
    });
    
    return NextResponse.json(statusInfo, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    
  } catch (error) {
    console.error('❌ 웹 통합 서비스 상태 확인 실패:', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    
    return NextResponse.json({
      overall: {
        status: 'error',
        message: '서비스 상태 확인 중 오류가 발생했습니다.'
      },
      services: {},
      environment: {},
      timestamp: new Date().toISOString(),
      version: 'web-integration-v1.0',
      error: 'status_check_failed'
    }, {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}
