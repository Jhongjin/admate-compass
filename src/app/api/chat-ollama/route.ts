import { NextRequest, NextResponse } from 'next/server';
import { createCompassServiceClient, getCompassDbSchema } from '@/lib/supabase/compass';
import { RAGSearchService, type EvidenceDecision } from '@/lib/services/RAGSearchService';
import { generateCompassAnswer, getCompassAnswerRuntimeStatus } from '@/lib/services/CompassAnswerLlmService';

// Compass answer runtime initialization. Secret values are never printed.
console.log('🔑 Compass answer runtime:', getCompassAnswerRuntimeStatus());
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
  hybridScore?: number;
  vectorScore?: number;
  keywordScore?: number;
  corpus?: string;
  evidenceType?: string;
  evidenceDecision?: EvidenceDecision | string;
  evidenceDecisionReason?: string[];
  rankReason?: string[];
  lexicalOverlap?: number;
  vendorMatch?: boolean;
  vendorMismatch?: boolean;
  sourceVendor?: string;
  sourceVendors?: string[];
  topicMatch?: boolean;
  retrievalMethod?: 'vector' | 'keyword' | 'hybrid' | 'fallback';
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
    linkedToDocument?: boolean;
    qualityScore?: number;
    corpus?: string;
    lexicalOverlap?: number;
    vendorMatch?: boolean;
    vendorMismatch?: boolean;
    sourceVendor?: string;
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
 * Compass RAG 검색
 */
async function searchWithCompassRAG(
  query: string,
  limit: number = 5
): Promise<SearchResult[]> {
  try {
    console.log(`🔍 Compass RAG 검색 시작: "${query}"`);
    
    if (!supabase) {
      console.warn('⚠️ Supabase 클라이언트가 없음. 근거 없는 답변 생성을 중단합니다.');
      return [];
    }

    // RAGSearchService 사용
    const ragService = new RAGSearchService();
    const searchResults = await ragService.searchSimilarChunks(query, limit);
    
    console.log(`📊 Compass RAG 검색 결과: ${searchResults.length}개`);
    
    return searchResults.map(result => ({
      chunk_id: result.id,
      content: result.content,
      similarity: result.similarity,
      score: result.score,
      hybridScore: result.hybridScore,
      vectorScore: result.vectorScore,
      keywordScore: result.keywordScore,
      corpus: result.corpus,
      evidenceType: result.evidenceType,
      evidenceDecision: result.evidenceDecision,
      evidenceDecisionReason: result.evidenceDecisionReason,
      rankReason: result.rankReason,
      lexicalOverlap: result.lexicalOverlap,
      vendorMatch: result.vendorMatch,
      vendorMismatch: result.vendorMismatch,
      sourceVendor: result.sourceVendor,
      sourceVendors: result.sourceVendors,
      topicMatch: result.topicMatch,
      retrievalMethod: result.retrievalMethod,
      documentId: result.documentId,
      documentTitle: result.documentTitle,
      documentUrl: result.documentUrl,
      sourceQuality: result.sourceQuality,
      metadata: result.metadata
    }));
    
  } catch (error) {
    console.error('❌ Compass RAG 검색 실패:', error);
    return [];
  }
}

/**
 * 신뢰도 계산
 */
function calculateConfidence(searchResults: SearchResult[]): number {
  if (searchResults.length === 0) return 0;
  
  const avgScore = searchResults.reduce((sum, result) => {
    const retrievalScore = result.hybridScore ?? result.score ?? result.similarity;
    const qualityScore = result.sourceQuality?.qualityScore ?? 0.6;
    const lexicalScore = result.lexicalOverlap ?? result.sourceQuality?.lexicalOverlap ?? 0;
    const vendorPenalty = result.vendorMismatch || result.sourceQuality?.vendorMismatch ? 0.15 : 0;
    return sum + (retrievalScore * 0.62) + (qualityScore * 0.2) + (lexicalScore * 0.18) - vendorPenalty;
  }, 0) / searchResults.length;
  return Math.min(avgScore * 100, 100);
}

function buildVerifiedSources(searchResults: SearchResult[]) {
  return searchResults.map(result => {
    console.log(`📚 Compass 출처 정보: 제목="${result.metadata?.title || '문서'}", 유사도=${result.similarity}`);
    const originalTitle = result.documentTitle || result.metadata?.originalTitle || result.metadata?.title || 'Meta 광고 정책 문서';
    const sourceVendor = result.sourceVendor || result.metadata?.sourceVendor || result.sourceQuality?.sourceVendor || 'UNKNOWN';
    const displayTitle = normalizeSourceTitle(originalTitle, sourceVendor, result.content);
    return {
      id: result.chunk_id,
      title: displayTitle,
      originalTitle,
      url: result.documentUrl || result.metadata?.source_url || result.metadata?.document_url || result.metadata?.url || '',
      updatedAt: result.metadata?.updatedAt || new Date().toISOString(),
      excerpt: result.content.substring(0, 200) + (result.content.length > 200 ? '...' : ''),
      similarity: result.similarity,
      score: result.score ?? result.similarity,
      hybridScore: result.hybridScore ?? result.metadata?.hybridScore,
      vectorScore: result.vectorScore ?? result.metadata?.vectorScore,
      keywordScore: result.keywordScore ?? result.metadata?.keywordScore,
      retrievalMethod: result.retrievalMethod || result.metadata?.retrievalMethod || 'vector',
      evidenceType: result.evidenceType || result.metadata?.evidenceType || result.retrievalMethod || 'vector',
      evidenceDecision: result.evidenceDecision || result.metadata?.evidenceDecision || 'weak',
      evidenceDecisionReason: result.evidenceDecisionReason || result.metadata?.evidenceDecisionReason || [],
      corpus: result.corpus || result.metadata?.corpus,
      rankReason: result.rankReason || result.metadata?.rankReason || [],
      lexicalOverlap: result.lexicalOverlap ?? result.metadata?.lexicalOverlap,
      vendorMatch: result.vendorMatch ?? result.metadata?.vendorMatch,
      vendorMismatch: result.vendorMismatch ?? result.metadata?.vendorMismatch,
      sourceVendor,
      sourceVendors: result.sourceVendors ?? result.metadata?.sourceVendors,
      topicMatch: result.topicMatch ?? result.metadata?.topicMatch,
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

function normalizeSourceTitle(title: string, sourceVendor: string, content: string): string {
  const blob = `${title} ${content}`.toLowerCase();

  if (
    sourceVendor === 'KAKAO'
    || blob.includes('카카오')
    || blob.includes('kakao')
    || blob.includes('비즈보드')
    || blob.includes('카카오톡')
    || blob.includes('모먼트')
  ) {
    return appendOriginalTitle('카카오 광고 심사 가이드', title);
  }

  if (
    sourceVendor === 'NAVER'
    || blob.includes('네이버')
    || blob.includes('naver')
    || blob.includes('쇼핑검색')
    || blob.includes('파워링크')
    || blob.includes('브랜드검색')
  ) {
    return appendOriginalTitle('네이버 광고 가이드', title);
  }

  if (
    sourceVendor === 'GOOGLE'
    || blob.includes('google')
    || blob.includes('구글')
    || blob.includes('youtube')
    || blob.includes('유튜브')
    || blob.includes('gdn')
  ) {
    return appendOriginalTitle('Google Ads 가이드', title);
  }

  if (
    sourceVendor === 'META'
    || blob.includes('meta')
    || blob.includes('메타')
    || blob.includes('facebook')
    || blob.includes('페이스북')
  ) {
    return title && title !== 'Unknown' ? title : 'Meta 광고 정책';
  }

  return title && title !== 'Unknown' ? title : '광고 정책 문서';
}

function appendOriginalTitle(normalizedTitle: string, originalTitle: string): string {
  if (!originalTitle || originalTitle === 'Unknown') return normalizedTitle;
  if (originalTitle.includes(normalizedTitle) || normalizedTitle.includes(originalTitle)) {
    return normalizedTitle;
  }
  return `${normalizedTitle}: ${originalTitle}`;
}


/**
 * Compass Chat API
 * POST /api/chat-ollama
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  // API 핸들러 내에서 환경변수 재확인. Secret values are never printed.
  console.log('🔍 Compass API 핸들러 내 환경변수 확인:');
  console.log('- Answer runtime:', getCompassAnswerRuntimeStatus());
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

    // 환경변수 상태 확인. Secret values are never printed.
    console.log('🔧 Compass 환경변수 상태:');
    console.log('- Answer runtime:', getCompassAnswerRuntimeStatus());
    console.log('- NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ 설정됨' : '❌ 미설정');
    console.log('- SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ 설정됨' : '❌ 미설정');

    console.log(`🚀 Compass RAG 챗봇 응답 생성 시작: "${message}"`);

    // 1. Compass RAG 검색
    const searchResults = await searchWithCompassRAG(message, 3);
    console.log(`📊 Compass 검색 결과: ${searchResults.length}개`);
    const verifiedSearchResults = searchResults.filter((result) => {
      const hasGrounding = typeof result.content === 'string' && result.content.trim().length > 0;
      const isFallback = result.retrievalMethod === 'fallback' || result.sourceQuality?.isFallback === true || result.metadata?.type === 'fallback';
      const isRejected = (result.evidenceDecision || result.metadata?.evidenceDecision) === 'rejected';
      return hasGrounding && !isFallback && !isRejected;
    });
    if (verifiedSearchResults.length !== searchResults.length) {
      console.warn(`⚠️ 근거 검증에서 제외된 검색 결과: ${searchResults.length - verifiedSearchResults.length}개`);
    }

    // 2. 검색 결과가 없으면 관련 내용 없음 응답
    if (verifiedSearchResults.length === 0) {
      console.log('⚠️ Compass RAG 검색 결과가 없음. 관련 내용 없음 응답');
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
        model: 'compass-answer-no-data'
      });
    }

    // 3. 설정된 답변 LLM으로 생성. Retrieval/source contract remains provider-agnostic.
    console.log('🚀 Compass 답변 LLM 생성 시작');
    
    const sources = buildVerifiedSources(verifiedSearchResults);
    const confidence = calculateConfidence(verifiedSearchResults);
    const schema = getCompassDbSchema();

    let answerResult;
    try {
      answerResult = await generateCompassAnswer(message, verifiedSearchResults);
    } catch (error) {
      console.error('❌ Compass 답변 LLM 생성 실패:', error);
      
      // 답변 LLM 실패와 retrieval 실패를 분리하기 위해 검증된 sources는 보존한다.
      return NextResponse.json({
        response: {
          message: "답변 생성 모델에 연결할 수 없습니다. 근거 문서는 확보했지만 생성 답변은 일시적으로 제한되어 있습니다.",
          content: "답변 생성 모델에 연결할 수 없습니다. 근거 문서는 확보했지만 생성 답변은 일시적으로 제한되어 있습니다.",
          sources,
          noDataFound: false,
          schema,
          showContactOption: true,
          error: true
        },
        confidence,
        processingTime: Date.now() - startTime,
        model: 'compass-answer-connection-failed'
      });
    }

    // 처리 시간 계산
    const processingTime = Date.now() - startTime;
    
    return NextResponse.json({
      response: {
        message: answerResult.answer,
        content: answerResult.answer,
        sources,
        noDataFound: false,
        schema,
        showContactOption: false
      },
      confidence,
      processingTime,
      model: 'compass-answer'
    });

  } catch (error) {
    console.error('❌ Compass RAG 응답 생성 실패:', error);
    
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
    let errorMessage = '죄송합니다. 현재 Compass 답변 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
    
    if (error instanceof Error) {
      if (error.message.includes('타임아웃')) {
        errorMessage = '죄송합니다. 서버 응답이 너무 느려서 타임아웃이 발생했습니다. 더 간단한 질문으로 다시 시도해주세요.';
      } else if (error.message.includes('연결할 수 없습니다')) {
        errorMessage = '죄송합니다. 답변 생성 모델에 연결할 수 없습니다. 서버 상태를 확인해주세요.';
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
      model: 'compass-answer-error'
    }, { status: 500 });
  }
}
