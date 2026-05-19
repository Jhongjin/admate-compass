import { NextRequest, NextResponse } from 'next/server';
import { createCompassServiceClient, getCompassDbSchema } from '@/lib/supabase/compass';
import { RAGSearchService, type EvidenceDecision } from '@/lib/services/RAGSearchService';
import { generateCompassAnswer } from '@/lib/services/CompassAnswerLlmService';

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
    console.log('Compass evidence retrieval started', { queryLength: query.length });
    
    if (!supabase) {
      console.warn('Compass evidence store is unavailable');
      return [];
    }

    // RAGSearchService 사용
    const ragService = new RAGSearchService();
    const searchResults = await ragService.searchSimilarChunks(query, limit);
    
    console.log('Compass evidence retrieval completed', { resultCount: searchResults.length });
    
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
    console.error('Compass evidence retrieval failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
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

function getEvidenceDecision(result: SearchResult): string | undefined {
  return result.evidenceDecision || result.metadata?.evidenceDecision;
}

function isVerifiedGrounding(result: SearchResult): boolean {
  const hasGrounding = typeof result.content === 'string' && result.content.trim().length > 0;
  const isFallback = result.retrievalMethod === 'fallback'
    || result.sourceQuality?.isFallback === true
    || result.metadata?.type === 'fallback';
  const evidenceDecision = getEvidenceDecision(result);
  return hasGrounding && !isFallback && evidenceDecision === 'verified';
}


/**
 * Compass answer API handler.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('Compass answer runtime request started');
  
  try {
    // JSON 파싱 오류 방지
    let requestBody;
    try {
      requestBody = await request.json();
    } catch (parseError) {
      console.error('Compass answer request payload parsing failed', {
        errorName: parseError instanceof Error ? parseError.name : 'UnknownError',
      });
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

    // 1. Compass RAG 검색
    const searchResults = await searchWithCompassRAG(message, 3);
    console.log('Compass answer evidence selected', { resultCount: searchResults.length });
    const verifiedSearchResults = searchResults.filter(isVerifiedGrounding);
    if (verifiedSearchResults.length !== searchResults.length) {
      console.warn('Compass answer evidence filtered', { filteredCount: searchResults.length - verifiedSearchResults.length });
    }

    // 2. 검색 결과가 없으면 관련 내용 없음 응답
    if (verifiedSearchResults.length === 0) {
      console.log('Compass answer request completed without grounded evidence');
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
    console.log('Compass answer generation started');
    
    const sources = buildVerifiedSources(verifiedSearchResults);
    const confidence = calculateConfidence(verifiedSearchResults);
    const schema = getCompassDbSchema();

    let answerResult;
    try {
      answerResult = await generateCompassAnswer(message, verifiedSearchResults);
    } catch (error) {
      console.error('Compass answer generation failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      
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
    console.log('Compass answer runtime request completed', { processingTime });
    
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
    console.error('Compass answer runtime request failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    
    // 에러 상세 정보 로깅
    if (error instanceof Error) {
      console.error('Compass answer runtime error detail:', {
        name: error.name,
      });
    } else {
      console.error('Compass answer runtime error detail:', { name: 'UnknownError' });
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
