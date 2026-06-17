import { NextRequest, NextResponse } from 'next/server';
import { buildCompassAnswerResponse } from '@/lib/server/compassAnswerHandler';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers,
  });
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: '챗봇 API가 정상적으로 작동합니다.',
    timestamp: new Date().toISOString(),
    methods: ['GET', 'POST', 'OPTIONS'],
    version: 'chatbot-v1',
    endpoint: '/api/chatbot',
    legacy: true,
    canonicalEndpoint: '/api/compass-answer',
    delegatedToCanonicalAnswerEngine: true,
  }, {
    status: 200,
    headers,
  });
}

function normalizeLegacySource(source: any) {
  const excerpt = source?.excerpt || source?.content || '';
  const score = source?.similarity ?? source?.score ?? source?.hybridScore ?? 0;

  return {
    id: source?.documentId || source?.id || source?.chunkId || 'unknown',
    title: source?.title || source?.documentTitle || source?.originalTitle || '광고 정책 문서',
    excerpt: excerpt ? `${String(excerpt).slice(0, 200)}${String(excerpt).length > 200 ? '...' : ''}` : '내용 없음',
    url: source?.url || source?.documentUrl || null,
    updatedAt: source?.updatedAt || new Date().toISOString().split('T')[0],
    similarity: Math.round(Number(score || 0) * 100),
  };
}

export async function POST(request: NextRequest) {
  console.log('Chatbot legacy API delegated to Compass answer engine');

  const result = await buildCompassAnswerResponse(request);
  const body = result.body as any;
  const status = result.status || 200;

  if (status >= 400 || body?.error) {
    return NextResponse.json({
      success: false,
      error: body?.error || '챗봇 응답 생성 중 오류가 발생했습니다.',
      details: body?.details || '일시적인 처리 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    }, {
      status,
      headers,
    });
  }

  const response = body?.response || {};
  const confidence = Number(body?.confidence ?? 0);

  return NextResponse.json({
    success: true,
    response: {
      message: response.message || response.content || '',
      sources: Array.isArray(response.sources) ? response.sources.map(normalizeLegacySource) : [],
      confidence: Math.round(confidence * 100),
      processingTime: body?.processingTime || 0,
      model: body?.model || 'compass-answer',
      isLLMGenerated: body?.model !== 'compass-answer-no-data' && body?.model !== 'compass-answer-error',
      canonicalEndpoint: '/api/compass-answer',
    },
  }, {
    status,
    headers,
  });
}
