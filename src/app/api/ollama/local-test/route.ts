import { NextRequest, NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';

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

// GET 메서드 - 로컬 테스트용 모의 응답
export async function GET() {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    console.log('🔍 로컬 테스트 모드 - 모의 Ollama 서버 응답');
    
    // 모의 모델 목록
    const mockModels = [
      {
        name: 'tinyllama:1.1b',
        id: 'mock-tinyllama-1.1b',
        size: 637 * 1024 * 1024, // 637MB
        modified_at: new Date().toISOString()
      },
      {
        name: 'llama2:7b',
        id: 'mock-llama2-7b',
        size: 3800 * 1024 * 1024, // 3.8GB
        modified_at: new Date().toISOString()
      },
      {
        name: 'mistral:7b',
        id: 'mock-mistral-7b',
        size: 4400 * 1024 * 1024, // 4.4GB
        modified_at: new Date().toISOString()
      }
    ];

    const response = {
      success: true,
      message: '로컬 테스트 모드 - 모의 Ollama 서버 응답',
      timestamp: new Date().toISOString(),
      server: {
        healthy: true,
        baseUrl: 'http://localhost:11434',
        actualUrl: 'http://localhost:11434',
        availableModels: mockModels.map(model => ({
          name: model.name,
          size: `${(model.size / 1024 / 1024 / 1024).toFixed(2)}GB`,
          modifiedAt: model.modified_at
        }))
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      version: 'ollama-mock-v1',
      endpoint: '/api/ollama/local-test',
      mode: 'mock'
    };

    console.log('📤 모의 API 응답:', {
      success: response.success,
      serverHealthy: response.server.healthy,
      modelsCount: response.server.availableModels.length
    });

    return NextResponse.json(response, {
      status: 200,
      headers,
    });

  } catch (error) {
    console.error('❌ 로컬 테스트 API 오류:', error);
    
    return NextResponse.json({
      success: false,
      error: '로컬 테스트 API 오류',
      details: error instanceof Error ? error.message : String(error)
    }, {
      status: 500,
      headers,
    });
  }
}

// POST 메서드 - 로컬 테스트용 모의 채팅 응답
export async function POST(request: NextRequest) {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    const body = await request.json();
    const { message, model = 'tinyllama:1.1b' } = body;

    console.log('🤖 로컬 테스트 모의 채팅:', { message, model });

    // 모의 응답 생성
    const mockResponse = `[모의 응답] 안녕하세요! 저는 ${model} 모델입니다. 
    
귀하의 질문: "${message}"

이것은 로컬 테스트 모드에서 생성된 모의 응답입니다. 
실제 Ollama 서버가 연결되면 더 정확한 답변을 제공할 수 있습니다.

현재 사용 중인 모델: ${model}
응답 생성 시간: ${new Date().toLocaleString()}`;

    const response = {
      success: true,
      response: {
        message: mockResponse,
        model: model,
        processingTime: Math.floor(Math.random() * 1000) + 500, // 500-1500ms
        server: 'Mock Ollama (Local Test)',
        timestamp: new Date().toISOString()
      }
    };

    console.log('📤 모의 채팅 응답 완료');

    return NextResponse.json(response, {
      status: 200,
      headers,
    });

  } catch (error) {
    console.error('❌ 로컬 테스트 채팅 오류:', error);
    
    return NextResponse.json({
      success: false,
      error: '로컬 테스트 채팅 오류',
      details: error instanceof Error ? error.message : String(error)
    }, {
      status: 500,
      headers,
    });
  }
}

