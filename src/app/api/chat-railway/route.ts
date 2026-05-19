import { NextRequest, NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';
import { RAGSearchService, SearchResult as RAGSearchResult } from '@/lib/services/RAGSearchService';
import { SearchResult } from '@/lib/services/VectorStorageService';

/**
 * RAGSearchResult를 VectorStorageService SearchResult로 변환
 */
function convertRAGSearchResults(ragResults: RAGSearchResult[]): SearchResult[] {
  return ragResults.map(result => ({
    chunk_id: result.id,
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
      chunk_id: 'fallback_instagram_ad_specs_0',
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
      chunk_id: 'fallback_facebook_ad_policy_0',
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
 * Railway Ollama 연결을 통한 답변 생성
 */
async function generateAnswerWithRailwayOllama(
  message: string, 
  searchResults: SearchResult[]
): Promise<string> {
  try {
    console.log('🚂 Railway Ollama 연결 답변 생성 시작');
    
    const railwayUrl = process.env.RAILWAY_OLLAMA_URL || 'https://meta-faq-ollama-production.up.railway.app';
    console.log('🔗 Railway URL:', railwayUrl);
    
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

    console.log('📤 Railway Ollama 요청 시작');
    
    // Railway Ollama 서버로 요청
    const response = await fetch(`${railwayUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Meta-FAQ-Chatbot/1.0',
        'Connection': 'keep-alive'
      },
      body: JSON.stringify({
        model: 'mistral:7b',
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          num_predict: 1000
        }
      }),
      signal: AbortSignal.timeout(30000) // 30초 타임아웃
    });

    console.log('📡 Railway Ollama 응답 상태:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Railway Ollama 응답 오류:', errorText);
      throw new Error(`Railway Ollama error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('✅ Railway Ollama 답변 생성 완료:', data);
    
    return data.response?.trim() || '답변을 생성할 수 없습니다.';

  } catch (error) {
    console.error('❌ Railway Ollama 답변 생성 실패:', error);
    throw error;
  }
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
 * Railway+Ollama 전용 Chat API
 * POST /api/chat-railway
 */
export async function POST(request: NextRequest) {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  const startTime = Date.now();
  let ragService: RAGSearchService | undefined;

  try {
    const { message } = await request.json();
    console.log(`🚂 Railway+Ollama RAG 챗봇 응답 생성 시작: "${message}"`);

    // 1. RAGSearchService 초기화 및 검색
    console.log('🔍 Railway+Ollama RAG 검색 시작:', `"${message}"`);
    ragService = new RAGSearchService();
    const ragSearchResults = await ragService.searchSimilarChunks(message, parseInt(process.env.TOP_K || '5'));
    console.log(`📊 Railway+Ollama 검색 결과: ${ragSearchResults.length}개`);
    
    // RAGSearchResult를 VectorStorageService SearchResult로 변환
    const searchResults = convertRAGSearchResults(ragSearchResults);

    // 2. 검색 결과가 없으면 관련 내용 없음 응답
    if (searchResults.length === 0) {
      console.log('⚠️ Railway+Ollama RAG 검색 결과가 없음. 관련 내용 없음 응답');
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
        model: 'railway-ollama-no-data'
      });
    }

    // 3. Railway+Ollama 답변 생성
    console.log('🚂 Railway+Ollama 답변 생성 시작');
    
    let answer: string;
    try {
      answer = await generateAnswerWithRailwayOllama(message, searchResults);
    } catch (error) {
      console.error('❌ Railway Ollama 연결 실패:', error);
      
      // Railway Ollama 서버 연결 실패 시 적절한 오류 메시지 반환
      return NextResponse.json({
        response: {
          message: "Railway Ollama 서버에 연결할 수 없습니다. 서버 상태를 확인해주세요.",
          content: "Railway Ollama 서버에 연결할 수 없습니다. 서버 상태를 확인해주세요.",
          sources: [],
          noDataFound: false,
          showContactOption: true,
          error: true
        },
        confidence: 0,
        processingTime: Date.now() - startTime,
        model: 'railway-ollama-connection-failed'
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

    console.log('✅ Railway+Ollama RAG 챗봇 응답 생성 완료');

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
      model: process.env.OLLAMA_DEFAULT_MODEL || 'mistral:7b'
    });

  } catch (error) {
    console.error('❌ Railway+Ollama RAG 챗봇 응답 생성 실패:', error);
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
