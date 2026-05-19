import { NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';

export async function GET() {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    const { resolveOllamaEndpoint } = await import('@/lib/services/ollamaEndpoint');
    console.log('🔍 환경변수 디버깅 시작');
    const answerEndpoint = resolveOllamaEndpoint();
    
    // 환경변수 확인 (값은 마스킹)
    const envStatus = {
      documentStore: {
        publicUrlConfigured: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        serviceCredentialConfigured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
      answerRuntime: {
        baseUrlConfigured: !!process.env.OLLAMA_BASE_URL,
        fallbackUrlConfigured: !!process.env.VULTR_OLLAMA_URL,
        defaultModelConfigured: !!process.env.OLLAMA_DEFAULT_MODEL,
        endpointStatus: {
          runtimeConfigured: answerEndpoint.configured,
          usingDevelopmentFallback: answerEndpoint.isDevelopmentFallback,
        },
      },
      nodeEnv: process.env.NODE_ENV
    };
    
    console.log('📊 환경변수 상태:', {
      documentStoreConfigured:
        envStatus.documentStore.publicUrlConfigured &&
        envStatus.documentStore.serviceCredentialConfigured,
      answerRuntimeConfigured: envStatus.answerRuntime.endpointStatus.runtimeConfigured,
      usingDevelopmentFallback: envStatus.answerRuntime.endpointStatus.usingDevelopmentFallback,
    });
    
    return NextResponse.json({
      success: true,
      envStatus,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 환경변수 디버깅 실패:', error);
    return NextResponse.json({
      success: false,
      error: '환경변수 디버깅 중 오류가 발생했습니다.',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
