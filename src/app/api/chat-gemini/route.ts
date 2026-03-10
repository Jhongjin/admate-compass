import { NextRequest, NextResponse } from 'next/server';
import { RAGSearchService, SearchResult as RAGSearchResult } from '@/lib/services/RAGSearchService';
import { SearchResult } from '@/lib/services/VectorStorageService';

/**
 * RAGSearchResult를 VectorStorageService SearchResult로 변환
 */
function convertRAGSearchResults(ragResults: RAGSearchResult[]): SearchResult[] {
  return ragResults.map((result, index) => ({
    chunk_id: result.id, // 문자열 ID 사용
    content: result.content,
    similarity: result.similarity,
    metadata: {
      title: result.documentTitle,
      url: result.documentUrl,
      ...result.metadata
    }
  }));
}

/**
 * Fallback 검색 결과 (검색 결과가 없을 때 사용)
 */
function getFallbackSearchResults(query: string, limit: number): SearchResult[] {
  return [
    {
      chunk_id: 'fallback_instagram_ad_specs_0', // 문자열로 되돌림
      content: `인스타그램 광고 사양 가이드

**스토리 광고**
- 크기: 1080x1920 픽셀 (9:16 비율)
- 최대 파일 크기: 30MB
- 지원 형식: MP4, MOV
- 최대 길이: 15초

**피드 광고**
- 크기: 1080x1080 픽셀 (1:1 비율)
- 최대 파일 크기: 30MB
- 지원 형식: MP4, MOV
- 최대 길이: 60초

**릴스 광고**
- 크기: 1080x1920 픽셀 (9:16 비율)
- 최대 파일 크기: 30MB
- 지원 형식: MP4, MOV
- 최대 길이: 90초

**텍스트 제한**
- 제목: 최대 30자
- 설명: 최대 2,200자
- 해시태그: 최대 30개`,
      similarity: 0.85,
      metadata: {
        title: '인스타그램 광고 사양 가이드',
        url: 'https://www.facebook.com/business/help/instagram/ads-specs'
      }
    },
    {
      chunk_id: 'fallback_facebook_ad_policy_0', // 문자열로 되돌림
      content: `페이스북 광고 정책

**이미지 광고**
- 크기: 1200x628 픽셀 (1.91:1 비율)
- 최대 파일 크기: 30MB
- 지원 형식: JPG, PNG
- 텍스트 제한: 이미지의 20% 이하

**동영상 광고**
- 크기: 1280x720 픽셀 (16:9 비율)
- 최대 파일 크기: 4GB
- 지원 형식: MP4, MOV, AVI
- 최대 길이: 240초

**카루셀 광고**
- 크기: 1080x1080 픽셀 (1:1 비율)
- 최대 파일 크기: 30MB
- 지원 형식: JPG, PNG
- 최대 10개 이미지

**광고 승인**
- 모든 광고는 Meta의 광고 정책을 준수해야 합니다.
- 정책 위반 시 광고가 거부될 수 있습니다.`,
      similarity: 0.8,
      metadata: {
        title: '페이스북 광고 정책',
        url: 'https://www.facebook.com/policies/ads'
      }
    }
  ];
}

/**
 * Google AI (Gemini) API를 통한 답변 생성 (재시도 로직 포함)
 */
async function generateAnswerWithGemini(
  message: string,
  searchResults: SearchResult[]
): Promise<string> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 Google AI (Gemini) 답변 생성 시작 (시도 ${attempt}/${maxRetries})`);

      const googleApiKey = process.env.GOOGLE_API_KEY;
      if (!googleApiKey) {
        console.warn('⚠️ GOOGLE_API_KEY is missing. Gemini API calls will fail.');
        throw new Error('GOOGLE_API_KEY 환경변수가 설정되지 않았습니다.');
      }

      // 검색 결과를 컨텍스트로 변환
      const context = searchResults.map(result =>
        `[${result.metadata?.title || '문서'}]: ${result.content.substring(0, 300)}`
      ).join('\n');

      // 프롬프트 구성
      const prompt = `다음은 Meta 광고 정책과 관련된 문서들입니다. 사용자의 질문에 대해 이 정보를 바탕으로 정확하고 도움이 되는 답변을 한국어로 제공해주세요.

사용자 질문: ${message}

관련 문서 정보:
${context}

답변 요구사항:
1. 제공된 문서 정보를 바탕으로 정확한 답변을 제공하세요
2. 답변은 한국어로 작성하세요
3. 답변이 불확실한 경우 그렇게 명시하세요
4. 답변 끝에 관련 출처를 간단히 언급하세요

답변:`;

      console.log('📤 Google AI (Gemini) 요청 시작');

      // Google AI (Gemini) API 호출
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${googleApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            maxOutputTokens: 1000,
          }
        }),
        signal: AbortSignal.timeout(60000) // 60초 타임아웃
      });

      console.log('📡 Google AI (Gemini) 응답 상태:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Google AI (Gemini) 응답 오류:', errorText);
        throw new Error(`Google AI (Gemini) error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ Google AI (Gemini) 답변 생성 완료:', data);

      // Google AI API 응답 형식에 따라 파싱
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '답변을 생성할 수 없습니다.';

    } catch (error) {
      lastError = error as Error;
      console.error(`❌ Google AI (Gemini) 답변 생성 실패 (시도 ${attempt}/${maxRetries}):`, error);

      if (attempt < maxRetries) {
        const delay = attempt * 2000; // 2초, 4초, 6초 대기
        console.log(`⏳ ${delay / 1000}초 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // 모든 재시도 실패
  console.error('❌ 모든 재시도 실패:', lastError);
  throw lastError || new Error('Google AI (Gemini) API 연결 실패');
}

/**
 * 신뢰도 계산
 */
function calculateConfidence(searchResults: SearchResult[]): number {
  if (searchResults.length === 0) return 0;
  const totalSimilarity = searchResults.reduce((sum, result) => sum + result.similarity, 0);
  return totalSimilarity / searchResults.length;
}

/**
 * Google AI (Gemini) 전용 Chat API
 * POST /api/chat-gemini
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let ragService: RAGSearchService | undefined;

  try {
    const { message } = await request.json();
    console.log(`🤖 Google AI (Gemini) RAG 챗봇 응답 생성 시작: "${message}"`);

    // 1. RAGSearchService 초기화 및 검색
    console.log('🔍 Google AI (Gemini) RAG 검색 시작:', `"${message}"`);
    ragService = new RAGSearchService();
    const ragSearchResults = await ragService.searchSimilarChunks(message, parseInt(process.env.TOP_K || '5'));
    console.log(`📊 Google AI (Gemini) 검색 결과: ${ragSearchResults.length}개`);

    // RAGSearchResult를 VectorStorageService SearchResult로 변환
    const searchResults = convertRAGSearchResults(ragSearchResults);

    // 2. 검색 결과가 없으면 관련 내용 없음 응답
    if (searchResults.length === 0) {
      console.log('⚠️ Google AI (Gemini) RAG 검색 결과가 없음. 관련 내용 없음 응답');
      return NextResponse.json({
        response: {
          message: "죄송합니다. 현재 제공된 문서에서 관련 정보를 찾을 수 없습니다. 더 구체적인 질문을 해주시거나 다른 키워드로 시도해보세요.",
          content: "죄송합니다. 현재 제공된 문서에서 관련 정보를 찾을 수 없습니다. 더 구체적인 질문을 해주시거나 다른 키워드로 시도해보세요.",
          sources: [],
          noDataFound: true,
          showContactOption: true
        },
        confidence: 0,
        processingTime: Date.now() - startTime,
        model: 'gemini-no-data'
      });
    }

    // 3. Google AI (Gemini) 답변 생성
    console.log('🚀 Google AI (Gemini) 답변 생성 시작');

    let answer: string;
    try {
      answer = await generateAnswerWithGemini(message, searchResults);
    } catch (error) {
      console.error('❌ Google AI (Gemini) 연결 실패:', error);

      // Google AI 서버 연결 실패 시 적절한 오류 메시지 반환
      return NextResponse.json({
        response: {
          message: "AI 서버에 연결할 수 없습니다. Google AI API 키를 확인하거나 잠시 후 다시 시도해주세요.",
          content: "AI 서버에 연결할 수 없습니다. Google AI API 키를 확인하거나 잠시 후 다시 시도해주세요.",
          sources: [],
          noDataFound: false,
          showContactOption: true,
          error: true
        },
        confidence: 0,
        processingTime: Date.now() - startTime,
        model: 'gemini-connection-failed'
      });
    }

    // 신뢰도 계산
    const confidence = calculateConfidence(searchResults);

    // 처리 시간 계산
    const processingTime = Date.now() - startTime;

    // 출처 정보 생성
    const sources = searchResults.map(result => ({
      title: result.metadata?.title || '문서',
      url: result.metadata?.url || '#',
      content: result.content.substring(0, 150) + '...'
    }));

    console.log('✅ Google AI (Gemini) RAG 챗봇 응답 생성 완료');

    return NextResponse.json({
      response: {
        message: answer,
        content: answer,
        sources: sources,
        noDataFound: false,
        showContactOption: false
      },
      confidence: confidence,
      processingTime: processingTime,
      model: 'gemini-2.0-flash'
    });

  } catch (error) {
    console.error('❌ Google AI (Gemini) RAG 챗봇 응답 생성 실패:', error);
    return NextResponse.json({
      response: {
        message: "죄송합니다. 서비스 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        content: "죄송합니다. 서비스 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        sources: [],
        noDataFound: true,
        showContactOption: true,
        error: true
      },
      confidence: 0,
      processingTime: Date.now() - startTime,
      model: 'error-fallback'
    }, { status: 500 });
  }
}

