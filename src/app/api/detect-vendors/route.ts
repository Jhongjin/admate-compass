import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const VENDORS = ['META', 'NAVER', 'KAKAO', 'GOOGLE', 'X(TWITTER)'] as const;

interface DetectVendorsRequest {
  query: string;
}

interface DetectVendorsResponse {
  vendors: string[];
  confidence: number;
  reasoning: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: DetectVendorsRequest = await request.json();
    const { query } = body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json(
        { error: '질문이 필요합니다.' },
        { status: 400 }
      );
    }

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ GOOGLE_GEMINI_API_KEY가 설정되지 않음. 키워드 기반 감지 사용');
      return NextResponse.json(detectVendorsByKeyword(query), { status: 200 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `다음 질문을 분석하여 관련된 광고 플랫폼을 추출하세요.

지원 플랫폼:
- META: Facebook, Instagram, Threads, Meta 광고
- NAVER: 네이버 검색광고, 네이버 광고
- KAKAO: 카카오 비즈보드, 카카오 광고
- GOOGLE: 구글 광고, Google Ads, 구글 마케팅
- X(TWITTER): 트위터, Twitter, X, 엑스 광고

질문: "${query}"

JSON 형식으로 응답하세요:
{
  "vendors": ["META", "GOOGLE"],
  "confidence": 0.9,
  "reasoning": "인스타그램과 구글 광고 정책 비교 질문"
}

관련 플랫폼이 없으면 vendors를 빈 배열로 반환하세요.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('JSON 파싱 실패: JSON 객체를 찾을 수 없음');
      }

      const parsed: Partial<DetectVendorsResponse> = JSON.parse(jsonMatch[0]);
      
      if (!parsed.vendors || !Array.isArray(parsed.vendors)) {
        throw new Error('JSON 파싱 실패: vendors 배열이 없음');
      }

      const validVendors = parsed.vendors
        .filter((v: any): v is string => typeof v === 'string')
        .map((v: string) => v.toUpperCase())
        .filter((v: string) => 
          VENDORS.includes(v as any) || 
          v === 'X' || v === 'TWITTER' || 
          v.includes('TWITTER') || v.includes('X')
        )
        .map((v: string) => {
          if (v === 'X' || v.includes('TWITTER') || v.includes('X')) {
            return 'X(TWITTER)';
          }
          return v;
        });

      const uniqueVendors = Array.from(new Set(validVendors));

      return NextResponse.json({
        vendors: uniqueVendors,
        confidence: parsed.confidence ?? 0.7,
        reasoning: parsed.reasoning || 'LLM 기반 자동 감지',
      } as DetectVendorsResponse);
    } catch (parseError) {
      console.error('❌ LLM 응답 파싱 오류:', parseError);
      console.log('🔄 키워드 기반 감지로 Fallback');
      return NextResponse.json(detectVendorsByKeyword(query), { status: 200 });
    }
  } catch (error: any) {
    console.error('❌ 벤더 감지 오류:', error);
    const body: DetectVendorsRequest = await request.json().catch(() => ({ query: '' }));
    return NextResponse.json(detectVendorsByKeyword(body.query || ''), { status: 200 });
  }
}

function detectVendorsByKeyword(query: string): DetectVendorsResponse {
  const lower = query.toLowerCase();
  const vendors: string[] = [];

  if (lower.includes('인스타') || lower.includes('instagram') || 
      lower.includes('페이스북') || lower.includes('facebook') || 
      lower.includes('meta') || lower.includes('threads')) {
    vendors.push('META');
  }

  if (lower.includes('네이버') || lower.includes('naver')) {
    vendors.push('NAVER');
  }

  if (lower.includes('카카오') || lower.includes('kakao') || lower.includes('비즈보드')) {
    vendors.push('KAKAO');
  }

  if (lower.includes('구글') || lower.includes('google') || lower.includes('구글 광고')) {
    vendors.push('GOOGLE');
  }

  if (lower.includes('트위터') || lower.includes('twitter') || 
      lower.includes('엑스') || lower.includes(' x ') || 
      lower.includes('x(') || lower.includes('x ')) {
    vendors.push('X(TWITTER)');
  }

  return {
    vendors: Array.from(new Set(vendors)),
    confidence: vendors.length > 0 ? 0.6 : 0.3,
    reasoning: '키워드 기반 자동 감지',
  };
}




