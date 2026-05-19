import { NextRequest, NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';
import { resolveOllamaEndpoint } from '@/lib/services/ollamaEndpoint';

function buildPublicGenerateResponse(data: any) {
  return {
    model: 'compass-answer',
    response: typeof data?.response === 'string' ? data.response : '',
    done: data?.done === true,
    context: Array.isArray(data?.context) ? data.context : undefined,
    total_duration: typeof data?.total_duration === 'number' ? data.total_duration : undefined,
    load_duration: typeof data?.load_duration === 'number' ? data.load_duration : undefined,
    prompt_eval_count: typeof data?.prompt_eval_count === 'number' ? data.prompt_eval_count : undefined,
    prompt_eval_duration: typeof data?.prompt_eval_duration === 'number' ? data.prompt_eval_duration : undefined,
    eval_count: typeof data?.eval_count === 'number' ? data.eval_count : undefined,
    eval_duration: typeof data?.eval_duration === 'number' ? data.eval_duration : undefined,
  };
}

/**
 * Managed answer runtime proxy API
 * Vercel 서버리스 함수에서 답변 런타임 서버로 요청을 중계
 */
export async function POST(request: NextRequest) {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    console.log('🔄 Managed answer runtime proxy started');
    
    const endpoint = resolveOllamaEndpoint();
    if (!endpoint.baseUrl) {
      return NextResponse.json({
        error: 'Compass answer service is not configured',
        runtimeConfigured: false,
        runtimeReachable: false
      }, { status: 503 });
    }
    console.log('🔗 Answer runtime proxy configuration:', {
      runtimeConfigured: endpoint.configured,
      usingDevelopmentFallback: endpoint.isDevelopmentFallback,
    });
    
    // 요청 본문을 답변 런타임으로 전달
    const requestBody = await request.json();
    console.log('📤 프록시 요청:', {
      hasPrompt: typeof requestBody?.prompt === 'string',
      model: requestBody?.model || null,
      stream: requestBody?.stream === true
    });
    
    // 답변 런타임 서버로 요청 전달
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
      console.error('❌ Answer runtime proxy upstream error:', {
        status: response.status,
        bodyLength: errorText.length,
      });
      throw new Error(`Answer runtime error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✅ Answer runtime proxy response succeeded');
    
    // Vercel에서 클라이언트로 응답 전달
    return NextResponse.json(buildPublicGenerateResponse(data));
    
  } catch (error) {
    console.error('❌ 프록시 오류:', error);
    
    return NextResponse.json({
      error: 'Compass answer service connection failed',
      details: 'Answer runtime proxy request failed.'
    }, { status: 500 });
  }
}
