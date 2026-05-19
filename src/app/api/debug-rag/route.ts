import { NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';

export async function GET() {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    const [{ RAGSearchService }, { resolveOllamaEndpoint }] = await Promise.all([
      import('@/lib/services/RAGSearchService'),
      import('@/lib/services/ollamaEndpoint'),
    ]);
    console.log('🔍 RAG 디버깅 시작');
    const answerEndpoint = resolveOllamaEndpoint();
    
    // 환경변수 확인
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
    
    // RAGSearchService 초기화 테스트
    let ragService;
    try {
      ragService = new RAGSearchService();
      console.log('✅ RAGSearchService 초기화 성공');
    } catch (error) {
      console.error('❌ RAGSearchService 초기화 실패:', error);
    }
    
    // 검색 테스트
    let searchResults: any[] = [];
    try {
      if (ragService) {
        searchResults = await ragService.searchSimilarChunks('광고 정책', 3);
        console.log('✅ 검색 테스트 성공:', searchResults.length, '개 결과');
      }
    } catch (error) {
      console.error('❌ 검색 테스트 실패:', error);
    }
    
    // 답변 생성 테스트
    let answer = '';
    try {
      if (ragService) {
        answer = await ragService.generateAnswer('광고 정책에 대해 알려주세요', searchResults);
        console.log('✅ 답변 생성 테스트 성공');
      }
    } catch (error) {
      console.error('❌ 답변 생성 테스트 실패:', error);
    }
    
    return NextResponse.json({
      success: true,
      envStatus,
      ragServiceStatus: ragService ? 'initialized' : 'failed',
      searchResultsCount: searchResults.length,
      answerPreview: answer.substring(0, 200) + (answer.length > 200 ? '...' : ''),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ RAG 디버깅 실패:', error);
    return NextResponse.json({
      success: false,
      error: 'RAG 디버깅 중 오류가 발생했습니다.',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
