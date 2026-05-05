import { NextRequest, NextResponse } from 'next/server';
import { getOllamaEndpointStatus, resolveOllamaEndpoint } from '@/lib/services/ollamaEndpoint';

/**
 * Vercel → Vultr Ollama 프록시 API
 * Vercel 서버리스 함수에서 Vultr Ollama 서버로 요청을 중계
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🔄 Vercel → Vultr Ollama 프록시 시작');
    
    const endpoint = resolveOllamaEndpoint();
    if (!endpoint.baseUrl) {
      return NextResponse.json({
        error: 'Ollama endpoint is not configured',
        endpoint: getOllamaEndpointStatus()
      }, { status: 503 });
    }
    console.log('🔗 Ollama endpoint:', getOllamaEndpointStatus());
    
    // 요청 본문을 Vultr로 전달
    const requestBody = await request.json();
    console.log('📤 프록시 요청:', {
      hasPrompt: typeof requestBody?.prompt === 'string',
      model: requestBody?.model || null,
      stream: requestBody?.stream === true
    });
    
    // Vultr Ollama 서버로 요청 전달
    const response = await fetch(`${endpoint.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000) // 30초 타임아웃
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Vultr Ollama 응답 오류:', errorText);
      throw new Error(`Vultr Ollama error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✅ Vultr Ollama 응답 성공');
    
    // Vercel에서 클라이언트로 응답 전달
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('❌ 프록시 오류:', error);
    
    return NextResponse.json({
      error: 'Vultr Ollama 서버 연결 실패',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
