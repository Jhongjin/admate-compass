import { NextRequest, NextResponse } from 'next/server';
import { createCompassServiceClient, getCompassDbSchema } from '@/lib/supabase/compass';
import { RAGSearchService } from '@/lib/services/RAGSearchService';
import { generateResponse } from '@/lib/services/ollama';
import { getOllamaEndpointStatus, resolveOllamaEndpoint } from '@/lib/services/ollamaEndpoint';

// Vultr+Ollama 전용 시스템 초기화
console.log('🔑 Vultr+Ollama 환경변수 확인:');
console.log('- Ollama endpoint:', getOllamaEndpointStatus());
console.log('- NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '설정됨' : '설정되지 않음');
console.log('- SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '설정됨' : '설정되지 않음');

// Supabase 클라이언트 초기화
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY 
  ? createCompassServiceClient()
  : null;

interface SearchResult {
  chunk_id: string;
  content: string;
  similarity: number;
  score?: number;
  retrievalMethod?: 'vector' | 'keyword' | 'fallback';
  documentId?: string;
  documentTitle?: string;
  documentUrl?: string;
  sourceQuality?: {
    hasDocumentId: boolean;
    hasTitle: boolean;
    hasUrl: boolean;
    hasExcerpt: boolean;
    isFallback: boolean;
    warnings: string[];
  };
  metadata: any;
}

interface ChatResponse {
  answer: string;
  sources: any[];
  confidence: number;
  processingTime: number;
  model: string;
}

/**
 * Vultr+Ollama 전용 RAG 검색
 */
async function searchWithOllamaRAG(
  query: string,
  limit: number = 5
): Promise<SearchResult[]> {
  try {
    console.log(`🔍 Vultr+Ollama RAG 검색 시작: "${query}"`);
    
    if (!supabase) {
      console.warn('⚠️ Supabase 클라이언트가 없음. 근거 없는 답변 생성을 중단합니다.');
      return [];
    }

    // RAGSearchService 사용 (Ollama 전용)
    const ragService = new RAGSearchService();
    const searchResults = await ragService.searchSimilarChunks(query, limit);
    
    console.log(`📊 Vultr+Ollama RAG 검색 결과: ${searchResults.length}개`);
    
    return searchResults.map(result => ({
      chunk_id: result.id,
      content: result.content,
      similarity: result.similarity,
      score: result.score,
      retrievalMethod: result.retrievalMethod,
      documentId: result.documentId,
      documentTitle: result.documentTitle,
      documentUrl: result.documentUrl,
      sourceQuality: result.sourceQuality,
      metadata: result.metadata
    }));
    
  } catch (error) {
    console.error('❌ Vultr+Ollama RAG 검색 실패:', error);
    return [];
  }
}

/**
 * Fallback 검색 결과 (RAG 실패 시)
 */
function getFallbackSearchResults(query: string, limit: number): SearchResult[] {
  console.log('⚠️ Vultr+Ollama RAG 실패. Fallback 데이터 사용');
  
  return [
    {
      chunk_id: 'fallback-1',
      content: 'Meta 광고 정책에 대한 기본 정보입니다. 더 자세한 내용은 관리자에게 문의해주세요.',
      similarity: 0.5,
      metadata: {
        title: 'Meta 광고 정책 기본 정보',
        type: 'fallback'
      }
    }
  ];
}



       /**
        * Vultr Ollama 직접 연결을 통한 답변 생성 (재시도 로직 포함)
        */
       async function generateAnswerWithOllamaDirect(
         message: string, 
         searchResults: SearchResult[]
       ): Promise<string> {
         const maxRetries = 3;
         let lastError: Error | null = null;
         
         for (let attempt = 1; attempt <= maxRetries; attempt++) {
           try {
             console.log(`🤖 Vultr Ollama 직접 연결 답변 생성 시작 (시도 ${attempt}/${maxRetries})`);
             
             const ollamaEndpoint = resolveOllamaEndpoint();
             if (!ollamaEndpoint.baseUrl) {
               throw new Error('Ollama endpoint is not configured for this environment.');
             }
             console.log('🔗 Ollama endpoint:', getOllamaEndpointStatus());
    
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

    console.log('📤 Vultr Ollama 직접 요청 시작');
    
           // Vultr Ollama 서버로 직접 요청 (타임아웃 60초로 증가)
           const response = await fetch(`${ollamaEndpoint.baseUrl}/api/generate`, {
             method: 'POST',
             headers: {
               'Content-Type': 'application/json',
               'User-Agent': 'Meta-FAQ-Chatbot/1.0',
               'Connection': 'keep-alive'
             },
             body: JSON.stringify({
               model: process.env.OLLAMA_DEFAULT_MODEL || process.env.OLLAMA_MODEL || 'mistral:7b',
               prompt: prompt,
               stream: false,
               options: {
                 temperature: 0.7,
                 top_p: 0.9,
                 num_predict: 1000
               }
             }),
             signal: AbortSignal.timeout(60000) // 60초로 증가
           });

    console.log('📡 Vultr Ollama 응답 상태:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Vultr Ollama 응답 오류:', errorText);
      throw new Error(`Vultr Ollama error: ${response.status} - ${errorText}`);
    }

             const data = await response.json();
             console.log('✅ Vultr Ollama 직접 답변 생성 완료:', data);
             
             return data.response?.trim() || '답변을 생성할 수 없습니다.';
             
           } catch (error) {
             lastError = error as Error;
             console.error(`❌ Vultr Ollama 직접 답변 생성 실패 (시도 ${attempt}/${maxRetries}):`, error);
             
             if (attempt < maxRetries) {
               const delay = attempt * 2000; // 2초, 4초, 6초 대기
               console.log(`⏳ ${delay/1000}초 후 재시도...`);
               await new Promise(resolve => setTimeout(resolve, delay));
             }
           }
         }
         
         // 모든 재시도 실패
         console.error('❌ 모든 재시도 실패:', lastError);
         throw lastError || new Error('Ollama 서버 연결 실패');
       }

/**
 * Vultr Ollama 프록시를 통한 답변 생성
 */
async function generateAnswerWithOllamaProxy(
  message: string, 
  searchResults: SearchResult[]
): Promise<string> {
  try {
    console.log('🤖 Vultr Ollama 프록시 답변 생성 시작');
    
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

    // Vercel 프록시 API 호출 (절대 URL 사용)
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
    const proxyUrl = `${baseUrl}/api/proxy-ollama`;
    console.log('🔗 프록시 URL:', proxyUrl);
    
    console.log('📤 프록시 API 요청 시작');
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OLLAMA_DEFAULT_MODEL || process.env.OLLAMA_MODEL || 'mistral:7b',
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9
        }
      }),
      signal: AbortSignal.timeout(30000)
    });

    console.log('📡 프록시 API 응답 상태:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ 프록시 API 오류:', errorText);
      throw new Error(`프록시 API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('✅ Vultr Ollama 프록시 답변 생성 완료:', data);
    
    return data.response?.trim() || '답변을 생성할 수 없습니다.';

  } catch (error) {
    console.error('❌ Vultr Ollama 프록시 답변 생성 실패:', error);
    
    // Fallback 답변 생성
    if (searchResults.length > 0) {
      const topResult = searchResults[0];
      return `**Meta 광고 정책 안내**

${topResult.content.substring(0, 400)}${topResult.content.length > 400 ? '...' : ''}

**검색된 관련 정보:**
${searchResults.map((result, index) => `${index + 1}. ${result.metadata?.title || '문서'}: ${result.content.substring(0, 100)}...`).join('\n')}

**더 자세한 정보:**
- Meta 비즈니스 도움말 센터: https://www.facebook.com/business/help
- 광고 정책 센터: https://www.facebook.com/policies/ads

관리자에게 문의하시면 더 구체적인 답변을 받으실 수 있습니다.`;
    }
    
    return '죄송합니다. 현재 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
  }
}

/**
 * 신뢰도 계산
 */
function calculateConfidence(searchResults: SearchResult[]): number {
  if (searchResults.length === 0) return 0;
  
  const avgSimilarity = searchResults.reduce((sum, result) => sum + result.similarity, 0) / searchResults.length;
  return Math.min(avgSimilarity * 100, 100);
}

function buildVerifiedSources(searchResults: SearchResult[]) {
  return searchResults.map(result => {
    console.log(`📚 Vultr+Ollama 출처 정보: 제목="${result.metadata?.title || '문서'}", 유사도=${result.similarity}`);
    return {
      id: result.chunk_id,
      title: result.documentTitle || result.metadata?.title || 'Meta 광고 정책 문서',
      url: result.documentUrl || result.metadata?.source_url || result.metadata?.document_url || result.metadata?.url || '',
      updatedAt: result.metadata?.updatedAt || new Date().toISOString(),
      excerpt: result.content.substring(0, 200) + (result.content.length > 200 ? '...' : ''),
      similarity: result.similarity,
      score: result.score ?? result.similarity,
      retrievalMethod: result.retrievalMethod || result.metadata?.retrievalMethod || 'vector',
      sourceQuality: result.sourceQuality || {
        hasDocumentId: Boolean(result.documentId),
        hasTitle: Boolean(result.documentTitle || result.metadata?.title),
        hasUrl: Boolean(result.documentUrl || result.metadata?.source_url || result.metadata?.document_url || result.metadata?.url),
        hasExcerpt: Boolean(result.content),
        isFallback: false,
        warnings: [],
      },
      documentId: result.documentId || result.metadata?.documentId || result.metadata?.document_id,
      chunkId: result.chunk_id,
      sourceType: result.metadata?.type || 'document',
      documentType: result.metadata?.documentType || 'policy'
    };
  });
}


/**
 * Vultr+Ollama 전용 Chat API
 * POST /api/chat-ollama
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  // API 핸들러 내에서 환경변수 재확인
  console.log('🔍 Vultr+Ollama API 핸들러 내 환경변수 확인:');
  console.log('- Ollama endpoint:', getOllamaEndpointStatus());
  console.log('- NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '설정됨' : '설정되지 않음');
  
  try {
    // JSON 파싱 오류 방지
    let requestBody;
    try {
      requestBody = await request.json();
    } catch (parseError) {
      console.error('❌ JSON 파싱 오류:', parseError);
      return NextResponse.json(
        { error: '잘못된 JSON 형식입니다.' },
        { status: 400 }
      );
    }
    
    const { message, conversationHistory } = requestBody;
    
    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: '메시지가 필요합니다.' },
        { status: 400 }
      );
    }

    // 환경변수 상태 확인
    console.log('🔧 Vultr+Ollama 환경변수 상태:');
    console.log('- Ollama endpoint:', getOllamaEndpointStatus());
    console.log('- NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ 설정됨' : '❌ 미설정');
    console.log('- SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ 설정됨' : '❌ 미설정');

    console.log(`🚀 Vultr+Ollama RAG 챗봇 응답 생성 시작: "${message}"`);

    // 1. Vultr+Ollama RAG 검색
    const searchResults = await searchWithOllamaRAG(message, 3);
    console.log(`📊 Vultr+Ollama 검색 결과: ${searchResults.length}개`);
    const verifiedSearchResults = searchResults.filter((result) => {
      const hasGrounding = typeof result.content === 'string' && result.content.trim().length > 0;
      const isFallback = result.retrievalMethod === 'fallback' || result.sourceQuality?.isFallback === true || result.metadata?.type === 'fallback';
      return hasGrounding && !isFallback;
    });
    if (verifiedSearchResults.length !== searchResults.length) {
      console.warn(`⚠️ 근거 검증에서 제외된 검색 결과: ${searchResults.length - verifiedSearchResults.length}개`);
    }

    // 2. 검색 결과가 없으면 관련 내용 없음 응답
    if (verifiedSearchResults.length === 0) {
      console.log('⚠️ Vultr+Ollama RAG 검색 결과가 없음. 관련 내용 없음 응답');
      return NextResponse.json({
        response: {
          message: "죄송합니다. 현재 제공된 문서에서 관련 정보를 찾을 수 없습니다. 더 구체적인 질문을 해주시거나 다른 키워드로 시도해보세요.",
          content: "죄송합니다. 현재 제공된 문서에서 관련 정보를 찾을 수 없습니다. 더 구체적인 질문을 해주시거나 다른 키워드로 시도해보세요.",
          sources: [],
          noDataFound: true,
          schema: getCompassDbSchema(),
          showContactOption: true
        },
        confidence: 0,
        processingTime: Date.now() - startTime,
        model: 'vultr-ollama-no-data'
      });
    }

    // 3. Vultr+Ollama 답변 생성 (프록시 API 사용)
    console.log('🚀 Vultr+Ollama 프록시 답변 생성 시작');
    
    const sources = buildVerifiedSources(verifiedSearchResults);
    const confidence = calculateConfidence(verifiedSearchResults);
    const schema = getCompassDbSchema();

    // Ollama만 사용 - fallback 없음
    let answer: string;
    try {
      answer = await generateAnswerWithOllamaDirect(message, verifiedSearchResults);
    } catch (error) {
      console.error('❌ Ollama 연결 실패:', error);
      
      // Ollama 생성 실패와 retrieval 실패를 분리하기 위해 검증된 sources는 보존한다.
      return NextResponse.json({
        response: {
          message: "Ollama 서버에 연결할 수 없습니다. Vultr 서버에서 Ollama 서비스를 시작해주세요.",
          content: "Ollama 서버에 연결할 수 없습니다. Vultr 서버에서 Ollama 서비스를 시작해주세요.",
          sources,
          noDataFound: false,
          schema,
          showContactOption: true,
          error: true
        },
        confidence,
        processingTime: Date.now() - startTime,
        model: 'ollama-connection-failed'
      });
    }

    // 처리 시간 계산
    const processingTime = Date.now() - startTime;
    
    return NextResponse.json({
      response: {
        message: answer,
        content: answer,
        sources,
        noDataFound: false,
        schema,
        showContactOption: false
      },
      confidence,
      processingTime,
      model: 'vultr-ollama-tinyllama'
    });

  } catch (error) {
    console.error('❌ Vultr+Ollama RAG 응답 생성 실패:', error);
    
    // 에러 상세 정보 로깅
    if (error instanceof Error) {
      console.error('❌ 에러 상세:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    } else {
      console.error('❌ 에러 상세:', JSON.stringify(error, null, 2));
    }
    
    const processingTime = Date.now() - startTime;
    
    // 에러 타입별 응답
    let errorMessage = '죄송합니다. 현재 Vultr+Ollama 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
    
    if (error instanceof Error) {
      if (error.message.includes('타임아웃')) {
        errorMessage = '죄송합니다. 서버 응답이 너무 느려서 타임아웃이 발생했습니다. 더 간단한 질문으로 다시 시도해주세요.';
      } else if (error.message.includes('연결할 수 없습니다')) {
        errorMessage = '죄송합니다. Ollama 서버에 연결할 수 없습니다. 서버 상태를 확인해주세요.';
      }
    }
    
    return NextResponse.json({
      response: {
        message: errorMessage,
        content: errorMessage,
        sources: [],
        noDataFound: true,
        schema: getCompassDbSchema(),
        showContactOption: true
      },
      confidence: 0,
      processingTime,
      model: 'vultr-ollama-error'
    }, { status: 500 });
  }
}
