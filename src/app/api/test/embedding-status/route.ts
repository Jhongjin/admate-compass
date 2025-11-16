import { NextRequest, NextResponse } from 'next/server';
import { embeddingService } from '@/lib/services/EmbeddingService';

export const dynamic = 'force-dynamic';

/**
 * BGE-M3 모델 초기화 상태 확인 API
 * 
 * GET /api/test/embedding-status
 * 
 * 응답:
 * {
 *   initialized: boolean,
 *   currentModel: string | null,
 *   status: 'ready' | 'initializing' | 'not_initialized' | 'failed',
 *   message: string
 * }
 */
export async function GET(request: NextRequest) {
  try {
    console.log('🔍 BGE-M3 모델 초기화 상태 확인 시작...');
    
    // EmbeddingService 싱글톤 인스턴스 상태 확인
    const isInitialized = embeddingService.initialized;
    
    // 현재 모델 정보 확인 (reflection을 통해)
    let currentModel: string | null = null;
    let status: 'ready' | 'initializing' | 'not_initialized' | 'failed' = 'not_initialized';
    let message = '';
    
    try {
      // private 속성에 접근하기 위해 any로 캐스팅
      const service = embeddingService as any;
      currentModel = service.currentModel || null;
      
      if (isInitialized && currentModel) {
        status = 'ready';
        message = `BGE-M3 모델이 정상적으로 초기화되어 있습니다. (모델: ${currentModel})`;
      } else if (isInitialized && !currentModel) {
        status = 'ready';
        message = '임베딩 서비스가 초기화되어 있지만 모델 정보를 확인할 수 없습니다.';
      } else {
        // 초기화되지 않은 경우, 초기화 시도 중인지 확인
        // pipeline이 null이 아니면 초기화 중일 수 있음
        const hasPipeline = service.pipeline !== null && service.pipeline !== undefined;
        
        if (hasPipeline) {
          status = 'initializing';
          message = 'BGE-M3 모델 초기화가 진행 중입니다. (백그라운드에서 계속 진행)';
        } else {
          status = 'not_initialized';
          message = 'BGE-M3 모델이 아직 초기화되지 않았습니다. 문서 처리는 해시 기반 임베딩을 사용합니다.';
        }
      }
    } catch (error) {
      console.error('❌ 모델 상태 확인 중 오류:', error);
      status = 'failed';
      message = `모델 상태 확인 중 오류 발생: ${error instanceof Error ? error.message : String(error)}`;
    }
    
    const response = {
      initialized: isInitialized,
      currentModel: currentModel,
      status: status,
      message: message,
      timestamp: new Date().toISOString(),
      cacheDir: process.env.VERCEL === '1' ? '/tmp/.cache/transformers' : './.cache/transformers',
      environment: {
        isVercel: process.env.VERCEL === '1',
        nodeEnv: process.env.NODE_ENV
      }
    };
    
    console.log('✅ BGE-M3 모델 초기화 상태 확인 완료:', response);
    
    return NextResponse.json({
      success: true,
      data: response
    });
    
  } catch (error) {
    console.error('❌ 모델 초기화 상태 확인 API 오류:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      data: {
        initialized: false,
        currentModel: null,
        status: 'failed' as const,
        message: `상태 확인 중 오류 발생: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date().toISOString()
      }
    }, { status: 500 });
  }
}


