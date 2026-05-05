import { NextRequest, NextResponse } from 'next/server';
import { getOllamaEndpointStatus, resolveOllamaEndpoint } from '@/lib/services/ollamaEndpoint';

// 기본 헤더 설정
const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// OPTIONS 메서드
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers,
  });
}

// GET 메서드 - Ollama 서버 진단
export async function GET() {
  try {
    console.log('🔍 Ollama 서버 진단 시작');
    
    const endpoint = resolveOllamaEndpoint();
    const results = {
      timestamp: new Date().toISOString(),
      endpoint: getOllamaEndpointStatus(),
      tests: [] as any[]
    };

    // 1. 기본 연결 테스트
    try {
      console.log('🔍 1. 기본 연결 테스트');
      if (!endpoint.baseUrl) {
        throw new Error('Ollama endpoint is not configured');
      }
      const startTime = Date.now();
      const response = await fetch(`${endpoint.baseUrl}/api/tags`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });
      const duration = Date.now() - startTime;
      
      results.tests.push({
        name: '기본 연결 테스트',
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        error: response.ok ? null : `HTTP ${response.status}: ${response.statusText}`
      });
      
      if (response.ok) {
        // 2. 모델 목록 조회 테스트
        try {
          console.log('🔍 2. 모델 목록 조회 테스트');
          const modelsResponse = await fetch(`${endpoint.baseUrl}/api/tags`, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(10000)
          });
          
          if (modelsResponse.ok) {
            const modelsData = await modelsResponse.json();
            results.tests.push({
              name: '모델 목록 조회 테스트',
              success: true,
              modelsCount: modelsData.models?.length || 0,
              models: modelsData.models?.map((m: any) => ({
                name: m.name,
                size: `${(m.size / 1024 / 1024 / 1024).toFixed(2)}GB`
              })) || []
            });
          } else {
            results.tests.push({
              name: '모델 목록 조회 테스트',
              success: false,
              error: `HTTP ${modelsResponse.status}: ${modelsResponse.statusText}`
            });
          }
        } catch (error) {
          results.tests.push({
            name: '모델 목록 조회 테스트',
            success: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }

        // 3. 간단한 채팅 테스트
        try {
          console.log('🔍 3. 간단한 채팅 테스트');
          const chatResponse = await fetch(`${endpoint.baseUrl}/api/generate`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'tinyllama:1.1b',
              prompt: 'Hello',
              stream: false
            }),
            signal: AbortSignal.timeout(60000)
          });
          
          if (chatResponse.ok) {
            const chatData = await chatResponse.json();
            results.tests.push({
              name: '간단한 채팅 테스트',
              success: true,
              response: chatData.response?.substring(0, 100) || 'No response',
              model: chatData.model
            });
          } else {
            results.tests.push({
              name: '간단한 채팅 테스트',
              success: false,
              error: `HTTP ${chatResponse.status}: ${chatResponse.statusText}`
            });
          }
        } catch (error) {
          results.tests.push({
            name: '간단한 채팅 테스트',
            success: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } catch (error) {
      results.tests.push({
        name: '기본 연결 테스트',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // 전체 결과 요약
    const successCount = results.tests.filter(t => t.success).length;
    const totalCount = results.tests.length;
    
    return NextResponse.json({
      success: true,
      message: `Ollama 서버 진단 완료 (${successCount}/${totalCount} 성공)`,
      ...results,
      summary: {
        totalTests: totalCount,
        successCount: successCount,
        failureCount: totalCount - successCount,
        overallHealth: successCount === totalCount ? 'healthy' : 'unhealthy'
      }
    }, {
      status: 200,
      headers,
    });

  } catch (error) {
    console.error('❌ Ollama 서버 진단 오류:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Ollama 서버 진단 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : String(error)
    }, {
      status: 500,
      headers,
    });
  }
}
