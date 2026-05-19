import { NextRequest, NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';
import { generateResponse } from '@/lib/services/ollama';
import { resolveOllamaEndpoint } from '@/lib/services/ollamaEndpoint';

function getAnswerRuntimeStatus(isReachable = false) {
  const endpoint = resolveOllamaEndpoint();
  return {
    runtimeConfigured: endpoint.configured,
    runtimeReachable: isReachable,
    usingDevelopmentFallback: endpoint.isDevelopmentFallback,
  };
}

// 기본 헤더 설정
const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// OPTIONS 메서드
export async function OPTIONS() {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  return new NextResponse(null, {
    status: 200,
    headers,
  });
}

// GET 메서드 - 답변 런타임 상태 및 모델 목록 확인
export async function GET() {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    console.log('🔍 Answer runtime GET request - checking service status');
    
    const endpoint = resolveOllamaEndpoint();
    console.log('🔧 Answer runtime configuration:', {
      runtimeConfigured: endpoint.configured,
      usingDevelopmentFallback: endpoint.isDevelopmentFallback,
    });
    
    // 직접 런타임 헬스 체크
    let isHealthy = false;
    let models = [];
    
    try {
      if (!endpoint.baseUrl) {
        throw new Error('Answer runtime is not configured');
      }

      console.log('🔍 Answer runtime health check');
      
      // 타임아웃 설정 (60초)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      
      const healthResponse = await fetch(`${endpoint.baseUrl}/api/tags`, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      clearTimeout(timeoutId);
      
      isHealthy = healthResponse.ok;
      console.log('🔍 헬스 체크 결과:', { 
        isHealthy, 
        status: healthResponse.status,
        statusText: healthResponse.statusText
      });
      
      if (isHealthy) {
        try {
          const modelsResponse = await fetch(`${endpoint.baseUrl}/api/tags`, {
            signal: controller.signal,
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          });
          
          if (modelsResponse.ok) {
            const modelsData = await modelsResponse.json();
            models = modelsData.models || [];
            console.log('📋 Available answer models count:', models.length);
          } else {
            console.error('❌ 모델 목록 조회 실패:', modelsResponse.status, modelsResponse.statusText);
            models = [];
          }
        } catch (error) {
          console.error('❌ 모델 목록 조회 오류:', error);
          models = [];
        }
      } else {
        console.error('❌ 서버 헬스 체크 실패:', {
          status: healthResponse.status,
          statusText: healthResponse.statusText
        });
      }
    } catch (error) {
      console.error('❌ Answer runtime connection error:', {
        error: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown'
      });
      isHealthy = false;
    }
    
    const response = {
      success: true,
      message: 'Compass answer service is operational.',
      timestamp: new Date().toISOString(),
      server: {
        healthy: isHealthy,
        ...getAnswerRuntimeStatus(isHealthy),
        reachable: isHealthy,
        availableModels: models.map((model: any) => ({
          name: model.name,
          size: `${(model.size / 1024 / 1024 / 1024).toFixed(2)}GB`,
          modifiedAt: model.modified_at
        }))
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      version: 'compass-answer',
      recommendedEndpoint: '/api/compass-answer'
    };

    console.log('📤 최종 API 응답:', {
      success: response.success,
      serverHealthy: response.server.healthy,
      modelsCount: response.server.availableModels.length
    });

    return NextResponse.json(response, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('❌ Answer runtime GET request error:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Compass answer service status check failed.',
      server: {
        healthy: false,
        ...getAnswerRuntimeStatus(false),
        reachable: false
      }
    }, {
      status: 500,
      headers,
    });
  }
}

// POST 메서드 - 답변 런타임을 통한 응답 생성
export async function POST(request: NextRequest) {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  console.log('🚀 Answer runtime POST request started');
  
  try {
    // 요청 본문 파싱
    const body = await request.json();
    const { message, model = 'tinyllama:1.1b' } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({
        success: false,
        error: '메시지가 필요합니다.',
        details: '유효한 메시지를 입력해주세요.'
      }, {
        status: 400,
        headers,
      });
    }

    console.log('💬 Answer runtime message received:', {
      messageLength: message.length,
      requestedModel: Boolean(model),
    });

    const endpoint = resolveOllamaEndpoint();
    console.log('🔧 Answer runtime POST configuration:', {
      runtimeConfigured: endpoint.configured,
      usingDevelopmentFallback: endpoint.isDevelopmentFallback,
    });

    // 답변 런타임 상태 확인
    let isHealthy = false;
    try {
      if (!endpoint.baseUrl) {
        throw new Error('Answer runtime is not configured');
      }
      const healthResponse = await fetch(`${endpoint.baseUrl}/api/tags`);
      isHealthy = healthResponse.ok;
      console.log('🔍 POST 요청 헬스 체크 결과:', { isHealthy, status: healthResponse.status });
    } catch (error) {
      console.error('❌ POST 요청 헬스 체크 오류:', error);
    }

    if (!isHealthy) {
      return NextResponse.json({
        success: false,
        error: 'Compass answer service connection error',
        details: 'Compass answer service is currently unavailable. Please check the service status.'
      }, {
        status: 503,
        headers,
      });
    }

    // 답변 런타임을 통한 응답 생성
    const startTime = Date.now();
    const response = await generateResponse(message.trim(), model);
    const processingTime = Date.now() - startTime;

    console.log('✅ Answer runtime response completed');

    const apiResponse = {
      success: true,
      response: {
        message: response,
        model: 'compass-answer',
        processingTime: processingTime,
        server: 'managed answer service',
        timestamp: new Date().toISOString()
      }
    };

    console.log('📤 Answer runtime API response sent');
    return NextResponse.json(apiResponse, {
      status: 200,
      headers,
    });

  } catch (error) {
    console.error('❌ Answer runtime POST request error:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Compass answer service failed to generate a response.',
      details: 'Answer runtime processing failed.'
    }, {
      status: 500,
      headers,
    });
  }
}
