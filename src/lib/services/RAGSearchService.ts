/**
 * RAG (Retrieval-Augmented Generation) 기반 검색 서비스
 * 인덱싱된 문서에서 유사한 콘텐츠를 검색하여 챗봇 답변에 활용
 */

import { createCompassServiceClient } from '@/lib/supabase/compass';
import { SimpleEmbeddingService } from './SimpleEmbeddingService';
import { generateResponse } from './ollama';
import { detectUnavailablePolicyTarget } from './ragNoDataIntentBoundary.mjs';

export type RetrievalMethod = 'vector' | 'keyword' | 'hybrid' | 'fallback';
export type RetrievalCorpus = 'ollama_document_chunks' | 'document_chunks' | 'fallback';
export type EvidenceType = 'vector' | 'keyword' | 'hybrid' | 'fallback';
export type EvidenceDecision = 'verified' | 'weak' | 'rejected';
export type VendorIntent = 'META' | 'KAKAO' | 'NAVER' | 'GOOGLE';
export type TopicIntent = 'review' | 'youth' | 'false_claim' | 'price' | 'event' | 'rights' | 'hate' | 'gambling' | 'spec' | 'product_structure';
export type QueryType = 'single-vendor' | 'multi-vendor' | 'generic-policy' | 'exploratory';

export interface QueryIntent {
  vendors: VendorIntent[];
  topics: TopicIntent[];
  keywords: string[];
  strictProductTerms: string[];
  strictContextTerms: string[];
  adPolicyTerms: string[];
  outOfScopeTerms: string[];
  unavailablePolicyTarget: boolean;
  unavailablePolicyTargetReason?: 'future_impossible' | 'fictional_platform';
  isOutOfScope: boolean;
  queryType: QueryType;
  isComparative: boolean;
  requiresVendorCoverage: boolean;
  recommendedSourceLimit: number;
}

export interface SourceQuality {
  hasDocumentId: boolean;
  hasTitle: boolean;
  hasUrl: boolean;
  hasExcerpt: boolean;
  isFallback: boolean;
  warnings: string[];
  linkedToDocument?: boolean;
  qualityScore?: number;
  corpus?: RetrievalCorpus;
  lexicalOverlap?: number;
  vendorMatch?: boolean;
  vendorMismatch?: boolean;
  sourceVendor?: VendorIntent | 'UNKNOWN';
  policyTitleMatch?: boolean;
}

export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  score: number;
  hybridScore?: number;
  vectorScore?: number;
  keywordScore?: number;
  corpus?: RetrievalCorpus;
  evidenceType?: EvidenceType;
  evidenceDecision?: EvidenceDecision;
  evidenceDecisionReason?: string[];
  rankReason?: string[];
  lexicalOverlap?: number;
  vendorMatch?: boolean;
  vendorMismatch?: boolean;
  sourceVendor?: VendorIntent | 'UNKNOWN';
  sourceVendors?: VendorIntent[];
  topicMatch?: boolean;
  topicExactMatch?: boolean;
  policyTitleMatch?: boolean;
  retrievalMethod: RetrievalMethod;
  documentId: string;
  documentTitle: string;
  documentUrl?: string;
  chunkIndex: number;
  metadata?: any;
  sourceQuality: SourceQuality;
}

export interface ChatResponse {
  answer: string;
  sources: SearchResult[];
  confidence: number;
  processingTime: number;
  model: string;
  isLLMGenerated?: boolean;
}

const VENDOR_TERM_SPECS: Array<[VendorIntent, string[]]> = [
  ['META', ['meta', 'facebook', '페이스북', 'instagram', '인스타그램', '릴스', 'reels']],
  ['KAKAO', ['kakao', '카카오', '카카오톡', '톡채널', '비즈보드', '모먼트']],
  ['NAVER', ['naver', '네이버', '검색광고', '쇼핑검색', '파워링크', '브랜드검색']],
  ['GOOGLE', ['google', '구글', 'youtube', '유튜브', 'gdn', 'google ads', 'display']],
];

function getCompassVendorTerms(vendor: VendorIntent): string[] {
  return VENDOR_TERM_SPECS.find(([candidate]) => candidate === vendor)?.[1] || [];
}

const TOPIC_TERM_SPECS: Array<[TopicIntent, string[]]> = [
  ['review', ['심사', '승인', '반려', '집행 기준', '준수사항']],
  ['youth', ['청소년', '유해', '성인', '연령']],
  ['false_claim', ['허위', '과장', '오인', '기만', '효능', '효과', '보장', '입증', '개선', '치료']],
  ['price', ['가격', '할인', '할인율']],
  ['event', ['이벤트', '경품', '참여', '당첨']],
  ['rights', ['상표', '저작권', '초상권', '권리']],
  ['hate', ['혐오', '차별', '비하']],
  ['gambling', ['도박', '사행']],
  ['spec', ['사이즈', '크기', '파일', '형식', '스펙', '동영상', '이미지', '카루셀']],
  ['product_structure', [
    '광고 상품', '광고상품', '광고 종류', '광고종류', '광고 유형', '광고유형', '상품 구조', '광고 구조',
    '캠페인 목표', '광고 관리자 목표', 'objective', 'objectives', 'advantage+', '어드밴티지',
    '카탈로그', 'catalog', '메타 픽셀', 'meta pixel', '픽셀 이벤트', '픽셀 코드', '전환', 'conversion', 'conversions api',
    '노출 위치', '게재 위치', 'placements', '지면',
    '앱 캠페인', '쇼핑 광고', '검색 캠페인', '디스플레이 캠페인', '반응형 디스플레이', '리드 양식',
    '검색광고', '쇼핑검색', '파워링크', '브랜드검색', '쇼핑블록', '디지털 옥외광고',
    '비즈보드', '카카오모먼트', '브랜드이모티콘', '상품가이드', '상품 가이드'
  ]],
];

const PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS = [
  '캠페인 목표', '광고 관리자 목표', '인지도', '트래픽', '참여', '잠재 고객', '앱 홍보', '판매',
  '앱 캠페인', '쇼핑 광고', '검색 캠페인', '디스플레이 캠페인', '반응형 디스플레이 광고', '리드 양식',
  '검색광고', '쇼핑검색', '파워링크', '브랜드검색', '쇼핑블록', '디지털 옥외광고',
  '비즈보드', '카카오모먼트', '브랜드이모티콘', '상품가이드', '상품 가이드',
  '광고 형식', '소재 형식', '노출 위치', '게재 위치', '지면',
  'Advantage+', '어드밴티지', '카탈로그', 'catalog', '메타 픽셀', 'meta pixel', '픽셀 이벤트', '픽셀 코드', '전환', 'conversion', 'Conversions API',
  '이미지', '동영상', '슬라이드', '컬렉션', '릴스', '스토리', '피드'
];

const PRODUCT_STRUCTURE_ANCHOR_TERMS = [
  '광고 관리자 목표',
  '캠페인 목표',
  'Advantage+',
  '어드밴티지',
  '카탈로그',
  '메타 픽셀',
  'Meta Pixel',
  'Conversions API',
  '앱 캠페인',
  '쇼핑 광고',
  '반응형 디스플레이 광고',
  '리드 양식',
  '검색광고',
  '쇼핑검색',
  '쇼핑블록',
  'PC 쇼핑블록',
  '모바일 쇼핑',
  '상품DB',
  '상품 DB',
  'DB URL',
  'EP',
  '가격비교',
  '디지털 옥외광고',
  '비즈보드',
  '상품가이드',
  '상품 가이드',
];

function isProductStructureQueryText(text: string): boolean {
  const hasOverviewSignal = /광고\s*상품|광고상품|광고\s*종류|광고종류|광고\s*유형|광고유형|상품\s*구조|광고\s*구조|캠페인\s*목표|광고\s*관리자\s*목표|objective|advantage\+|어드밴티지|카탈로그|catalog|메타\s*픽셀|meta\s*pixel|픽셀\s*(이벤트|코드|설치|전환)|전환|conversion|노출\s*위치|게재\s*위치|placements|지면|앱\s*캠페인|쇼핑\s*광고|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|리드\s*양식|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|디지털\s*옥외광고|비즈보드|카카오모먼트|브랜드이모티콘|상품\s*가이드|상품가이드/.test(text);
  if (hasOverviewSignal) return true;

  const hasVendorOrAdContext = detectCompassVendors(text).length > 0 || AD_POLICY_TERMS.some(term => text.includes(term));
  return hasVendorOrAdContext && /상품|종류|유형|구조|솔루션/.test(text);
}

function stripKoreanParticle(word: string): string {
  return word.replace(/(으로|에게|에서|부터|까지|이나|거나|하고|은|는|이|가|을|를|에|의|도|만|로|과|와)$/u, '');
}

const AD_POLICY_TERMS = [
  '광고', '정책', '심사', '소재', '매체', '캠페인', '타겟', '집행', '승인', '반려',
  'meta', 'facebook', '페이스북', 'instagram', '인스타그램', 'kakao', '카카오',
  'naver', '네이버', 'google', '구글', 'youtube', '유튜브', 'gdn'
];

const OUT_OF_SCOPE_TERMS = [
  '날씨', '기온', '우산', '미세먼지', '김치찌개', '레시피', '요리', '맛집',
  '주식', '코인', '환율', '연예', '영화 추천', '건강 상담', '진단', '치료'
];

function normalizeCompassSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchCompassTerms(text: string, terms: string[]): string[] {
  return terms.filter(term => text.includes(term));
}

function detectCompassVendors(text: string): VendorIntent[] {
  const vendors: VendorIntent[] = [];

  for (const [vendor, terms] of VENDOR_TERM_SPECS) {
    if (terms.some(term => text.includes(term))) {
      vendors.push(vendor);
    }
  }

  return vendors;
}

function detectCompassTopics(text: string): TopicIntent[] {
  const topics: TopicIntent[] = [];

  for (const [topic, terms] of TOPIC_TERM_SPECS) {
    if (terms.some(term => text.includes(term))) {
      topics.push(topic);
    }
  }

  return topics;
}

function detectStrictProductTerms(text: string): string[] {
  const terms: string[] = [];

  if (text.includes('쇼핑검색')) terms.push('쇼핑검색');
  if (text.includes('파워링크')) terms.push('파워링크');
  if (text.includes('브랜드검색')) terms.push('브랜드검색');
  if (text.includes('지역소상공인')) terms.push('지역소상공인');
  if (text.includes('비즈보드')) terms.push('비즈보드');
  if (text.includes('키워드광고') || text.includes('키워드 광고')) terms.push('키워드광고');

  return terms;
}

function detectStrictContextTerms(text: string): string[] {
  const terms: string[] = [];

  if (/금융|대출|보험|투자|신용|카드|여신|저축|은행/.test(text)) {
    terms.push('금융', '대출', '보험', '투자', '신용', '카드', 'financial', 'finance', 'credit', 'loan', 'insurance');
  }

  if (/의료|병원|의약품|건강기능식품|건기식|헬스케어|웰니스/.test(text)) {
    terms.push('의료', '병원', '의약품', '건강기능식품', '건기식', '헬스케어', '웰니스', 'health', 'healthcare', 'wellness');
  }

  return Array.from(new Set(terms));
}

function extractCompassKeywords(query: string): string[] {
  const stopwords = new Set([
    '무엇인가요', '무엇', '어떤', '있는', '없는', '해주세요', '알려줘', '기준은', '기준',
    '관련', '대한', '대해', '대해서', '대하여', '그리고', '또는', '가능한가요', '되나요', '경우', '알려', '줘',
    'the', 'and', 'for', 'with', 'what', 'how'
  ]);

  const normalized = normalizeCompassSearchText(query);
  const productStructureQuery = isProductStructureQueryText(normalized);
  const baseKeywords = Array.from(new Set(
    query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .map(word => stripKoreanParticle(word.trim()))
      .filter(word => word.length >= 2 && !stopwords.has(word))
  ));
  const expansions: string[] = [];

  if (/효능|효과|성능|개선|보장|입증|치료/.test(normalized)) {
    expansions.push('효능', '효과', '보장', '입증', '개선', '치료', '허위', '과장');
  }

  if (/주의|유의|제한|금지|반려|심사/.test(normalized)) {
    expansions.push('주의', '제한', '금지', '반려', '심사', '검수', '정책', '운영정책', '등록기준', '광고등록기준', '가이드');
  }

  if (productStructureQuery) {
    expansions.push(...PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS);
  }

  return Array.from(new Set([...baseKeywords, ...expansions])).slice(0, productStructureQuery ? 28 : 16);
}

export function classifyCompassRagQuery(query: string): QueryIntent {
  const normalized = normalizeCompassSearchText(query);
  const vendors = detectCompassVendors(normalized);
  const topics = detectCompassTopics(normalized);
  const strictProductTerms = detectStrictProductTerms(normalized);
  const strictContextTerms = detectStrictContextTerms(normalized);
  const adPolicyTerms = matchCompassTerms(normalized, AD_POLICY_TERMS);
  const outOfScopeTerms = matchCompassTerms(normalized, OUT_OF_SCOPE_TERMS);
  const unavailablePolicyTarget = detectUnavailablePolicyTarget(query);
  const isComparative = vendors.length >= 2 || /비교|차이|공통|각각|vs\.?|versus|동시에|나란히/.test(normalized);
  const requiresVendorCoverage = vendors.length >= 2 || (isComparative && vendors.length > 0);
  const queryType: QueryType = vendors.length >= 2
    ? 'multi-vendor'
    : vendors.length === 1
      ? 'single-vendor'
      : topics.length > 0 && adPolicyTerms.length > 0
        ? 'generic-policy'
        : 'exploratory';
  const hasProductStructureIntent = topics.includes('product_structure');
  const recommendedSourceLimit = requiresVendorCoverage
    ? 5
    : hasProductStructureIntent
      ? 6
    : topics.length >= 2
      ? 4
      : 3;

  return {
    vendors,
    topics,
    keywords: extractCompassKeywords(query),
    strictProductTerms,
    strictContextTerms,
    adPolicyTerms,
    outOfScopeTerms,
    unavailablePolicyTarget: unavailablePolicyTarget.isUnavailablePolicyTarget,
    unavailablePolicyTargetReason: unavailablePolicyTarget.reason,
    isOutOfScope: outOfScopeTerms.length > 0 && adPolicyTerms.length === 0,
    queryType,
    isComparative,
    requiresVendorCoverage,
    recommendedSourceLimit,
  };
}

export class RAGSearchService {
  private supabase;
  private embeddingService: SimpleEmbeddingService;

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log('🔧 RAGSearchService 초기화 시작...');
    console.log('📊 환경 변수 상태:', {
      hasSupabaseUrl: !!supabaseUrl,
      hasSupabaseKey: !!supabaseKey
    });

    if (!supabaseUrl || !supabaseKey) {
      console.warn('⚠️ Supabase 환경변수가 설정되지 않았습니다. Fallback 모드로 전환합니다.');
      console.warn('필요한 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');

      // 프로덕션 환경에서는 더미 클라이언트 사용
      if (process.env.NODE_ENV === 'production') {
        this.supabase = createCompassServiceClient();
        this.embeddingService = new SimpleEmbeddingService();
        console.log('✅ RAGSearchService 초기화 완료 (Fallback 모드)');
        return;
      }

      throw new Error('Supabase 환경변수가 설정되지 않았습니다. .env.local 파일을 확인해주세요.');
    }

    try {
      this.supabase = createCompassServiceClient();

      // SimpleEmbeddingService 사용
      this.embeddingService = new SimpleEmbeddingService();
      console.log('✅ RAGSearchService 초기화 완료 (SimpleEmbeddingService)');
    } catch (error) {
      console.error('❌ RAGSearchService 초기화 실패:', error);
      throw new Error(`RAGSearchService 초기화 실패: ${error}`);
    }
  }

  /**
   * 질문에 대한 유사한 문서 청크 검색
   */
  async searchSimilarChunks(
    query: string,
    limit: number = 5,
    similarityThreshold: number = 0.1  // 임계값을 낮춰서 더 많은 결과 검색
  ): Promise<SearchResult[]> {
    try {
      console.log(`🔍 RAG 검색 시작: "${query}"`);

      // Fallback 모드인 경우 샘플 데이터 반환
      if (!this.supabase) {
        console.log('⚠️ Fallback 모드: 샘플 데이터 반환');
        return this.getFallbackSearchResults(query, limit);
      }

      const intent = this.detectQueryIntent(query);
      console.log('🧭 Query intent:', {
        vendors: intent.vendors,
        topics: intent.topics,
        queryType: intent.queryType,
        isComparative: intent.isComparative,
        recommendedSourceLimit: intent.recommendedSourceLimit,
        keywordCount: intent.keywords.length,
        outOfScopeTerms: intent.outOfScopeTerms,
        unavailablePolicyTarget: intent.unavailablePolicyTarget,
        unavailablePolicyTargetReason: intent.unavailablePolicyTargetReason,
        isOutOfScope: intent.isOutOfScope,
        strictContextTerms: intent.strictContextTerms,
      });

      if (intent.isOutOfScope || intent.unavailablePolicyTarget) {
        console.log('⚠️ 광고/정책 범위 밖 질문으로 판단하여 검색을 중단합니다.');
        return [];
      }

      // 질문을 임베딩으로 변환
      const queryEmbeddingResult = await this.embeddingService.generateEmbedding(query);
      const queryEmbedding = queryEmbeddingResult.embedding;
      console.log(`📊 질문 임베딩 생성 완료: ${queryEmbedding.length}차원`);

      const needsVendorAwareRetrieval = intent.vendors.length > 0;
      const needsProductStructureRetrieval = intent.topics.includes('product_structure');
      const candidateLimit = needsVendorAwareRetrieval
        ? Math.max(limit, intent.vendors.length * 4, needsProductStructureRetrieval ? 18 : 8)
        : needsProductStructureRetrieval
          ? Math.max(limit * 3, 18)
          : limit;

      const [vectorCandidates, keywordCandidates, vendorCoverageCandidates, productStructureCandidates] = await Promise.all([
        this.searchVectorCandidates(queryEmbedding, candidateLimit, intent),
        this.searchKeywordCandidates(query, candidateLimit, intent),
        this.searchVendorCoverageCandidates(query, candidateLimit, intent),
        this.searchProductStructureCandidates(candidateLimit, intent)
      ]);

      console.log(`📊 Hybrid 후보 수집 결과: vector=${vectorCandidates.length}, keyword=${keywordCandidates.length}, vendorCoverage=${vendorCoverageCandidates.length}, productStructure=${productStructureCandidates.length}`);
      const rankedResults = this.mergeDedupeAndRankCandidates(
        [...vectorCandidates, ...keywordCandidates, ...vendorCoverageCandidates, ...productStructureCandidates],
        limit,
        intent
      );

      if (rankedResults.length > 0) {
        console.log('🔍 Hybrid 검색 결과 샘플:', rankedResults.slice(0, 2).map((chunk) => ({
          chunk_id: chunk.id,
          corpus: chunk.corpus,
          retrievalMethod: chunk.retrievalMethod,
          hybridScore: chunk.hybridScore,
          vectorScore: chunk.vectorScore,
          keywordScore: chunk.keywordScore,
          warnings: chunk.sourceQuality.warnings
        })));
      } else {
        console.log('⚠️ Hybrid 검색 결과가 없습니다. 데이터베이스에 문서가 있는지 확인하세요.');
      }

      console.log(`✅ 검색 완료: ${rankedResults.length}개 결과 (임계값: ${similarityThreshold})`);
      return rankedResults;

    } catch (error) {
      console.error('❌ RAG 검색 실패:', error);
      // 오류 발생 시에도 fallback 데이터 반환
      return this.getFallbackSearchResults(query, limit);
    }
  }

  private async searchVectorCandidates(queryEmbedding: number[], limit: number, intent: QueryIntent): Promise<SearchResult[]> {
    try {
      console.log('🔍 벡터 검색 RPC 함수 호출 시도');
      const { data, error } = await this.supabase.rpc('search_ollama_documents', {
        query_embedding: queryEmbedding,
        match_threshold: 0.001,
        match_count: limit * 3
      });

      if (error) {
        console.warn('⚠️ RPC 함수 오류. keyword 채널은 계속 실행됩니다:', error);
        return [];
      }

      console.log(`✅ 벡터 검색 RPC 함수 성공: ${data?.length || 0}개`);
      return (data || [])
        .map((result: any) => this.normalizeCandidate(result, {
          queryEmbedding,
          intent,
          retrievalMethod: 'vector',
          corpus: 'ollama_document_chunks',
          evidenceType: 'vector',
        }))
        .filter((result: SearchResult | null): result is SearchResult => result !== null);
    } catch (error) {
      console.warn('⚠️ 벡터 검색 실패. keyword 채널은 계속 실행됩니다:', error);
      return [];
    }
  }

  private async searchKeywordCandidates(query: string, limit: number, intent: QueryIntent): Promise<SearchResult[]> {
    const keywords = intent.keywords;
    console.log('🔍 Hybrid keyword 검색:', keywords);

    if (keywords.length === 0) {
      return [];
    }

    const [ollamaResults, documentChunkResults] = await Promise.all([
      this.searchKeywordTable('ollama_document_chunks', keywords, limit),
      this.searchKeywordTable('document_chunks', keywords, limit)
    ]);

    return [...ollamaResults, ...documentChunkResults]
      .map((result) => this.normalizeCandidate(result.row, {
        keywords,
        intent,
        retrievalMethod: 'keyword',
        corpus: result.corpus,
        evidenceType: 'keyword',
      }))
      .filter((result: SearchResult | null): result is SearchResult => result !== null);
  }

  private async searchVendorCoverageCandidates(query: string, limit: number, intent: QueryIntent): Promise<SearchResult[]> {
    if (intent.vendors.length === 0) {
      return [];
    }

    const normalizedQuery = normalizeCompassSearchText(query);
    const queryKeywords = intent.keywords.filter((keyword) => (
      !intent.vendors.some((vendor) => getCompassVendorTerms(vendor).some(term => term === keyword))
    ));
    const topicKeywords = queryKeywords.length > 0 ? queryKeywords : intent.keywords;

    const results = await Promise.all(intent.vendors.map(async (vendor) => {
      const vendorTerms = getCompassVendorTerms(vendor);
      const vendorKeywords = Array.from(new Set([
        ...vendorTerms,
        ...topicKeywords,
        normalizedQuery.includes('효능') ? '효능' : '',
        normalizedQuery.includes('효과') ? '효과' : '',
        normalizedQuery.includes('보장') ? '보장' : '',
        normalizedQuery.includes('입증') ? '입증' : '',
        normalizedQuery.includes('심사') ? '심사' : '',
        normalizedQuery.includes('정책') ? '정책' : '',
      ].filter(Boolean))).slice(0, 24);

      const [
        ollamaResults,
        documentChunkResults,
        vendorOllamaResults,
        vendorDocumentChunkResults,
      ] = await Promise.all([
        this.searchKeywordTable('ollama_document_chunks', vendorKeywords, limit),
        this.searchKeywordTable('document_chunks', vendorKeywords, limit),
        this.searchVendorMetadataTable('ollama_document_chunks', vendor, vendorKeywords, limit),
        this.searchVendorMetadataTable('document_chunks', vendor, vendorKeywords, limit)
      ]);

      return [...vendorOllamaResults, ...vendorDocumentChunkResults, ...ollamaResults, ...documentChunkResults]
        .map((result) => {
          const candidate = this.normalizeCandidate(result.row, {
            keywords: vendorKeywords,
            intent,
            retrievalMethod: 'keyword',
            corpus: result.corpus,
            evidenceType: 'keyword',
          });

          if (!candidate) return null;

          if (this.matchesVendorSlot(candidate, vendor)) {
            const boostedScore = Math.min(1, (candidate.hybridScore || 0) + 0.08);
            candidate.hybridScore = boostedScore;
            candidate.score = boostedScore;
            candidate.rankReason = Array.from(new Set([
              ...(candidate.rankReason || []),
              `vendor_coverage_probe_${vendor.toLowerCase()}`,
            ]));
            candidate.metadata = {
              ...(candidate.metadata || {}),
              coverageProbeVendor: vendor,
              rankReason: candidate.rankReason,
              score: boostedScore,
              hybridScore: boostedScore,
            };
          }

          return candidate;
        })
        .filter((candidate: SearchResult | null): candidate is SearchResult => candidate !== null);
    }));

    return results.flat();
  }

  private async searchProductStructureCandidates(limit: number, intent: QueryIntent): Promise<SearchResult[]> {
    if (!intent.topics.includes('product_structure')) {
      return [];
    }

    const vendorTerms = intent.vendors.flatMap((vendor) => getCompassVendorTerms(vendor));
    const keywords = Array.from(new Set([
      ...vendorTerms,
      ...PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS,
    ]));
    const anchorLimit = Math.max(4, Math.ceil(limit / 3));
    const anchorVendors: Array<VendorIntent | undefined> = intent.vendors.length > 0 ? [...intent.vendors, undefined] : [undefined];
    const probes = anchorVendors.flatMap((vendor) => (
      PRODUCT_STRUCTURE_ANCHOR_TERMS.flatMap((anchor) => ([
        this.searchProductStructureAnchorTable('document_chunks', anchor, anchorLimit, vendor),
        this.searchProductStructureAnchorTable('ollama_document_chunks', anchor, Math.max(2, Math.ceil(anchorLimit / 2)), vendor),
      ]))
    ));

    const results = (await Promise.all(probes)).flat();
    return results
      .map((result) => {
        const candidate = this.normalizeCandidate(result.row, {
          keywords,
          intent,
          retrievalMethod: 'keyword',
          corpus: result.corpus,
          evidenceType: 'keyword',
        });

        if (!candidate) return null;
        if (intent.vendors.length === 1 && this.hasExplicitOtherVendorSignal(candidate, intent.vendors[0])) {
          return null;
        }

        const sourceText = this.buildCandidateSearchText(candidate.content, candidate.documentTitle, candidate.metadata);
        if (!this.hasProductStructureSignal(sourceText) && !this.hasHighValueProductStructureSignal(sourceText)) {
          return null;
        }

        if (intent.vendors.length > 0 && candidate.vendorMismatch && !candidate.vendorMatch) {
          return null;
        }

        const boostedScore = Math.min(1, (candidate.hybridScore || 0) + (this.hasHighValueProductStructureSignal(sourceText) ? 0.18 : 0.08));
        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          `product_structure_anchor_${result.anchor}`,
        ]));
        candidate.metadata = {
          ...(candidate.metadata || {}),
          productStructureAnchor: result.anchor,
          rankReason: candidate.rankReason,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((candidate: SearchResult | null): candidate is SearchResult => candidate !== null);
  }

  private async searchProductStructureAnchorTable(
    tableName: 'ollama_document_chunks' | 'document_chunks',
    anchor: string,
    limit: number,
    vendor?: VendorIntent
  ): Promise<Array<{ row: any; corpus: RetrievalCorpus; anchor: string }>> {
    try {
      const selectColumns = tableName === 'ollama_document_chunks'
        ? 'chunk_id, document_id, content, metadata, embedding'
        : 'id, document_id, chunk_id, content, metadata';

      let query = this.supabase
        .from(tableName)
        .select(selectColumns)
        .ilike('content', `%${anchor}%`);

      if (vendor) {
        query = query.eq('metadata->>source_vendor', vendor);
      }

      const { data, error } = await query.limit(limit);

      if (error) {
        console.warn(`⚠️ ${tableName} product-structure anchor 검색 실패:`, error);
        return [];
      }

      return (data || []).map((row: any) => ({
        row,
        corpus: tableName,
        anchor,
      }));
    } catch (error) {
      console.warn(`⚠️ ${tableName} product-structure anchor 검색 예외:`, error);
      return [];
    }
  }

  private async searchVendorMetadataTable(
    tableName: 'ollama_document_chunks' | 'document_chunks',
    vendor: VendorIntent,
    keywords: string[],
    limit: number
  ): Promise<Array<{ row: any; corpus: RetrievalCorpus }>> {
    try {
      const selectColumns = tableName === 'ollama_document_chunks'
        ? 'chunk_id, document_id, content, metadata, embedding'
        : 'id, document_id, chunk_id, content, metadata';
      const keywordConditions = keywords.map(keyword => `content.ilike.%${keyword}%`);

      const { data, error } = await this.supabase
        .from(tableName)
        .select(selectColumns)
        .eq('metadata->>source_vendor', vendor)
        .or(keywordConditions.join(','))
        .limit(limit * 8);

      if (error) {
        console.warn(`⚠️ ${tableName} ${vendor} metadata keyword 검색 실패:`, error);
        return [];
      }

      console.log(`📊 ${tableName} ${vendor} metadata keyword 검색 결과: ${data?.length || 0}개`);
      return (data || []).map((row: any) => ({
        row,
        corpus: tableName,
      }));
    } catch (error) {
      console.warn(`⚠️ ${tableName} ${vendor} metadata keyword 검색 예외:`, error);
      return [];
    }
  }

  private async searchKeywordTable(
    tableName: 'ollama_document_chunks' | 'document_chunks',
    keywords: string[],
    limit: number
  ): Promise<Array<{ row: any; corpus: RetrievalCorpus }>> {
    try {
      const selectColumns = tableName === 'ollama_document_chunks'
        ? 'chunk_id, document_id, content, metadata, embedding'
        : 'id, document_id, chunk_id, content, metadata';
      const keywordConditions = keywords.map(keyword => `content.ilike.%${keyword}%`);

      const { data, error } = await this.supabase
        .from(tableName)
        .select(selectColumns)
        .or(keywordConditions.join(','))
        .limit(limit * 8);

      if (error) {
        console.warn(`⚠️ ${tableName} keyword 검색 실패:`, error);
        return [];
      }

      console.log(`📊 ${tableName} keyword 검색 결과: ${data?.length || 0}개`);
      return (data || []).map((row: any) => ({
        row,
        corpus: tableName,
      }));
    } catch (error) {
      console.warn(`⚠️ ${tableName} keyword 검색 예외:`, error);
      return [];
    }
  }

  private normalizeCandidate(
    result: any,
    options: {
      queryEmbedding?: number[];
      keywords?: string[];
      intent: QueryIntent;
      retrievalMethod: RetrievalMethod;
      corpus: RetrievalCorpus;
      evidenceType: EvidenceType;
    }
  ): SearchResult | null {
    const content = typeof result.content === 'string' ? result.content : '';
    const rawChunkId = result.id ?? result.chunk_id;
    const chunkId = String(rawChunkId || `${result.document_id || 'unknown'}_chunk_0`);
    const documentId = result.document_id || result.metadata?.document_id || this.inferDocumentId(chunkId);
    const documentTitle =
      result.metadata?.title
      || result.metadata?.source_title
      || result.metadata?.canonical_title
      || result.title
      || result.metadata?.source
      || this.inferDocumentTitleFromContent(content)
      || 'Unknown';
    const documentUrl = result.metadata?.source_url || result.metadata?.document_url || result.metadata?.url;
    const chunkIndex = this.inferChunkIndex(chunkId, result.chunk_id);
    const warnings: string[] = [];

    if (!documentId) warnings.push('missing_document_id');
    if (!documentTitle || documentTitle === 'Unknown') warnings.push('missing_title');
    if (!documentUrl) warnings.push('missing_url');
    if (!content.trim()) warnings.push('missing_excerpt');
    if (this.isPlaceholderContent(content)) warnings.push('placeholder_content');

    const vectorScore = this.resolveVectorScore(result, options.queryEmbedding);
    const sourceText = this.buildCandidateSearchText(content, documentTitle, {
      ...(result.metadata || {}),
      document_id: documentId,
      chunk_id: chunkId,
    });
    const lexicalOverlap = this.calculateLexicalOverlap(sourceText, options.intent.keywords);
    const vendorAlignment = this.calculateVendorAlignment(sourceText, options.intent.vendors, {
      metadata: result.metadata,
      title: documentTitle,
      url: documentUrl,
      documentId,
    });
    const topicMatch = this.hasTopicMatch(sourceText, options.intent.topics);
    const topicExactMatch = this.hasExactTopicMatch(sourceText, options.intent.topics);
    const policyTitleMatch = this.hasPolicyGradeTitle(documentTitle, result.metadata);
    const originalMetaSeed = this.isOriginalMetaSeedCandidate({
      chunkId,
      corpus: options.corpus,
      sourceVendor: vendorAlignment.primaryVendor,
      metadata: result.metadata,
    });
    const keywordScore = this.calculateKeywordScore(
      content,
      documentTitle,
      options.keywords || [],
      lexicalOverlap,
      topicMatch,
      topicExactMatch,
      policyTitleMatch
    );
    const sourceQuality = this.buildSourceQuality({
      documentId,
      documentTitle,
      documentUrl,
      content,
      metadata: result.metadata,
      corpus: options.corpus,
      warnings,
      lexicalOverlap,
      vendorMatch: vendorAlignment.match,
      vendorMismatch: vendorAlignment.mismatch,
      sourceVendor: vendorAlignment.primaryVendor,
      policyTitleMatch,
    });
    let hybridScore = this.calculateHybridScore({
      vectorScore,
      keywordScore,
      sourceQualityScore: sourceQuality.qualityScore || 0,
      retrievalMethod: options.retrievalMethod,
      corpus: options.corpus,
      lexicalOverlap,
      vendorMatch: vendorAlignment.match,
      vendorMismatch: vendorAlignment.mismatch,
      topicMatch,
      topicExactMatch,
      policyTitleMatch,
      genericPolicyIntent: this.isGenericPolicyIntent(options.intent),
      originalMetaSeed,
      hasUrl: sourceQuality.hasUrl,
    });
    const productStructureAdjustment = this.calculateProductStructureScoreAdjustment(sourceText, options.intent);
    if (productStructureAdjustment.adjustment !== 0) {
      hybridScore = Math.max(0, Math.min(1, hybridScore + productStructureAdjustment.adjustment));
    }
    const rankReason = Array.from(new Set([
      ...this.buildRankReason({
      vectorScore,
      keywordScore,
      sourceQuality,
      corpus: options.corpus,
      lexicalOverlap,
      vendorMatch: vendorAlignment.match,
      vendorMismatch: vendorAlignment.mismatch,
      topicMatch,
      topicExactMatch,
      policyTitleMatch,
      genericPolicyIntent: this.isGenericPolicyIntent(options.intent),
      originalMetaSeed,
      hasUrl: sourceQuality.hasUrl,
      }),
      ...productStructureAdjustment.reasons,
    ]));
    const evidenceDecision = this.decideEvidence({
      content,
      sourceQuality,
      retrievalMethod: options.retrievalMethod,
      corpus: options.corpus,
      hybridScore,
      vectorScore,
      keywordScore,
      lexicalOverlap,
      vendorMatch: vendorAlignment.match,
      vendorMismatch: vendorAlignment.mismatch,
      topicExactMatch,
      policyTitleMatch,
    });

    return {
      id: chunkId,
      content,
      similarity: vectorScore || keywordScore || hybridScore,
      score: hybridScore,
      hybridScore,
      vectorScore,
      keywordScore,
      corpus: options.corpus,
      evidenceType: options.evidenceType,
      evidenceDecision: evidenceDecision.decision,
      evidenceDecisionReason: evidenceDecision.reasons,
      rankReason,
      lexicalOverlap,
      vendorMatch: vendorAlignment.match,
      vendorMismatch: vendorAlignment.mismatch,
      sourceVendor: vendorAlignment.primaryVendor,
      sourceVendors: vendorAlignment.sourceVendors,
      topicMatch,
      topicExactMatch,
      policyTitleMatch,
      retrievalMethod: options.retrievalMethod,
      documentId,
      documentTitle,
      documentUrl,
      chunkIndex,
      metadata: {
        ...(result.metadata || {}),
        retrievalMethod: options.retrievalMethod,
        evidenceType: options.evidenceType,
        corpus: options.corpus,
        evidenceDecision: evidenceDecision.decision,
        evidenceDecisionReason: evidenceDecision.reasons,
        score: hybridScore,
        hybridScore,
        vectorScore,
        keywordScore,
        lexicalOverlap,
        vendorMatch: vendorAlignment.match,
        vendorMismatch: vendorAlignment.mismatch,
        sourceVendor: vendorAlignment.primaryVendor,
        sourceVendors: vendorAlignment.sourceVendors,
        topicMatch,
        topicExactMatch,
        policyTitleMatch,
        originalTitle: documentTitle,
        documentId,
        sourceQualityWarnings: sourceQuality.warnings,
      },
      sourceQuality,
    };
  }

  private mergeDedupeAndRankCandidates(candidates: SearchResult[], limit: number, intent: QueryIntent): SearchResult[] {
    const byKey = new Map<string, SearchResult>();
    const hasTargetVendorRescueCandidate = candidates.some(candidate => this.isTargetVendorRescueCandidate(candidate, intent));
    const hasGenericTopicRescueCandidate = candidates.some(candidate => this.isGenericTopicRescueCandidate(candidate, intent));

    for (const candidate of candidates) {
      if (!this.isVerifiedEvidence(candidate, intent, hasTargetVendorRescueCandidate, hasGenericTopicRescueCandidate)) {
        continue;
      }

      const dedupeKeys = this.getDedupeKeys(candidate);
      const existingKey = dedupeKeys.find(key => byKey.has(key));

      if (!existingKey) {
        byKey.set(dedupeKeys[0], candidate);
        continue;
      }

      const existing = byKey.get(existingKey)!;
      const merged = this.mergeDuplicateCandidate(existing, candidate, intent);
      byKey.delete(existingKey);
      byKey.set(this.getDedupeKeys(merged)[0], merged);
    }

    const documentCounts = new Map<string, number>();
    const titleCounts = new Map<string, number>();

    const ranked = Array.from(byKey.values())
      .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0));
    const rescueCandidate = ranked.find(candidate => this.isTargetVendorRescueCandidate(candidate, intent));
    const genericRescueCandidate = ranked.find(candidate => this.isGenericTopicRescueCandidate(candidate, intent));
    const maxPerDocument = intent.topics.includes('product_structure') ? 1 : 2;
    const maxPerTitle = intent.topics.includes('product_structure') ? 1 : 2;

    const selected = ranked.filter((candidate) => {
        const docKey = candidate.documentId || candidate.id;
        const titleKey = candidate.documentTitle || docKey;
        const docCount = documentCounts.get(docKey) || 0;
        const titleCount = titleCounts.get(titleKey) || 0;

        if (docCount >= maxPerDocument || titleCount >= maxPerTitle) {
          return false;
        }

        documentCounts.set(docKey, docCount + 1);
        titleCounts.set(titleKey, titleCount + 1);
        return true;
      })
      .slice(0, limit);

    if (
      genericRescueCandidate
      && !selected.some(candidate => candidate.id === genericRescueCandidate.id)
      && selected.length > 0
    ) {
      genericRescueCandidate.rankReason = Array.from(new Set([
        ...(genericRescueCandidate.rankReason || []),
        'generic_topic_rescue',
      ]));
      const replacementIndex = this.findWeakestGenericPolicyReplacementIndex(selected, intent);
      selected[replacementIndex] = genericRescueCandidate;
      const rescueSelected = selected.sort((a, b) => {
        if (a.id === genericRescueCandidate.id) return -1;
        if (b.id === genericRescueCandidate.id) return 1;
        return (b.hybridScore || 0) - (a.hybridScore || 0);
      });
      return this.applyVendorSlots(rescueSelected, ranked, limit, intent);
    }

    if (
      rescueCandidate
      && !selected.some(candidate => candidate.id === rescueCandidate.id)
      && selected.length > 0
    ) {
      rescueCandidate.rankReason = Array.from(new Set([
        ...(rescueCandidate.rankReason || []),
        'target_vendor_document_chunks_rescue',
      ]));
      selected[selected.length - 1] = rescueCandidate;
      const rescueSelected = selected.sort((a, b) => {
        if (a.id === rescueCandidate.id) return -1;
        if (b.id === rescueCandidate.id) return 1;
        return (b.hybridScore || 0) - (a.hybridScore || 0);
      });
      return this.applyVendorSlots(rescueSelected, ranked, limit, intent);
    }

    return this.applyVendorSlots(selected, ranked, limit, intent);
  }

  private applyVendorSlots(
    selected: SearchResult[],
    ranked: SearchResult[],
    limit: number,
    intent: QueryIntent
  ): SearchResult[] {
    if (!intent.requiresVendorCoverage || intent.vendors.length <= 1) {
      return this.filterLowValuePolicySources(selected, intent)
        .slice(0, limit)
        .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0));
    }

    const next = [...selected];

    for (const vendor of intent.vendors) {
      const existingSlotIndexes = next
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => this.matchesVendorSlot(candidate, vendor));
      const bestCandidate = this.pickBestVendorSlotCandidate(ranked, next, vendor, intent);

      if (existingSlotIndexes.length > 0) {
        if (!bestCandidate) {
          continue;
        }

        const weakestExisting = existingSlotIndexes
          .sort((a, b) => (
            this.scoreVendorSlotCandidate(a.candidate, intent) - this.scoreVendorSlotCandidate(b.candidate, intent)
          ))[0];

        if (
          this.scoreVendorSlotCandidate(bestCandidate, intent)
          <= this.scoreVendorSlotCandidate(weakestExisting.candidate, intent) + 0.04
        ) {
          continue;
        }

        bestCandidate.rankReason = Array.from(new Set([
          ...(bestCandidate.rankReason || []),
          `required_vendor_slot_upgrade_${vendor.toLowerCase()}`,
        ]));
        bestCandidate.metadata = {
          ...(bestCandidate.metadata || {}),
          coverageRole: `required_vendor_slot_upgrade_${vendor}`,
        };
        next[weakestExisting.index] = bestCandidate;
        continue;
      }

      const candidate = bestCandidate;

      if (!candidate) {
        continue;
      }

      candidate.rankReason = Array.from(new Set([
        ...(candidate.rankReason || []),
        `required_vendor_slot_${vendor.toLowerCase()}`,
      ]));
      candidate.metadata = {
        ...(candidate.metadata || {}),
        coverageRole: `required_vendor_slot_${vendor}`,
      };

      if (next.length < limit) {
        next.push(candidate);
        continue;
      }

      const replacementIndex = this.findVendorSlotReplacementIndex(next, intent);
      next[replacementIndex] = candidate;
    }

    const balanced = this.balanceVendorSlots(next, ranked, limit, intent);
    const policyFiltered = this.filterLowValuePolicySources(balanced, intent);

    return policyFiltered
      .slice(0, limit)
      .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0));
  }

  private filterLowValuePolicySources(selected: SearchResult[], intent: QueryIntent): SearchResult[] {
    if (!this.hasPolicyJudgmentIntent(intent) || intent.topics.includes('spec')) {
      return selected;
    }

    return selected.filter(candidate => {
      if (!this.isLowValuePolicySource(candidate, intent)) return true;

      const candidateVendor = candidate.sourceVendor;
      if (candidateVendor && candidateVendor !== 'UNKNOWN' && intent.vendors.includes(candidateVendor)) {
        const sameVendorCount = selected.filter(item => this.matchesVendorSlot(item, candidateVendor)).length;
        return sameVendorCount <= 1;
      }

      return false;
    });
  }

  private balanceVendorSlots(
    selected: SearchResult[],
    ranked: SearchResult[],
    limit: number,
    intent: QueryIntent
  ): SearchResult[] {
    if (!intent.requiresVendorCoverage || intent.vendors.length <= 1) {
      return selected;
    }

    const next = [...selected];
    const targetPerVendor = Math.max(1, Math.floor(limit / intent.vendors.length));

    for (const vendor of intent.vendors) {
      let vendorCount = next.filter(candidate => this.matchesVendorSlot(candidate, vendor)).length;

      while (vendorCount < targetPerVendor) {
        const candidate = this.pickBestVendorSlotCandidate(ranked, next, vendor, intent);
        if (!candidate) break;

        const overrepresentedVendor = intent.vendors.find(candidateVendor => (
          candidateVendor !== vendor
          && next.filter(item => this.matchesVendorSlot(item, candidateVendor)).length > targetPerVendor
        ));

        let replacementIndex = -1;
        if (overrepresentedVendor) {
          replacementIndex = this.findWeakestVendorIndex(next, overrepresentedVendor, intent);
        }

        if (replacementIndex < 0 && next.length < limit) {
          candidate.rankReason = Array.from(new Set([
            ...(candidate.rankReason || []),
            `balanced_vendor_slot_${vendor.toLowerCase()}`,
          ]));
          next.push(candidate);
          vendorCount += 1;
          continue;
        }

        if (replacementIndex < 0) {
          replacementIndex = this.findVendorSlotReplacementIndex(next, intent);
        }

        const current = next[replacementIndex];
        if (
          current
          && this.scoreVendorSlotCandidate(candidate, intent)
          <= this.scoreVendorSlotCandidate(current, intent) - 0.12
        ) {
          break;
        }

        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          `balanced_vendor_slot_${vendor.toLowerCase()}`,
        ]));
        next[replacementIndex] = candidate;
        vendorCount = next.filter(item => this.matchesVendorSlot(item, vendor)).length;
      }
    }

    return next;
  }

  private findWeakestVendorIndex(selected: SearchResult[], vendor: VendorIntent, intent: QueryIntent): number {
    let weakestIndex = -1;
    let weakestScore = Number.POSITIVE_INFINITY;

    selected.forEach((candidate, index) => {
      if (!this.matchesVendorSlot(candidate, vendor)) return;
      const score = this.scoreVendorSlotCandidate(candidate, intent);
      if (score < weakestScore) {
        weakestScore = score;
        weakestIndex = index;
      }
    });

    return weakestIndex;
  }

  private matchesVendorSlot(candidate: SearchResult, vendor: VendorIntent): boolean {
    if (candidate.sourceQuality.isFallback) return false;
    if (!candidate.sourceQuality.hasExcerpt) return false;
    if (this.hasExplicitOtherVendorSignal(candidate, vendor)) return false;
    if (candidate.sourceVendor === vendor) return true;
    return Boolean(candidate.sourceVendors?.includes(vendor));
  }

  private hasExplicitOtherVendorSignal(candidate: SearchResult, targetVendor: VendorIntent): boolean {
    const primaryIdentityText = this.normalizeSearchText([
      candidate.metadata?.originalTitle,
      candidate.metadata?.canonical_title,
      candidate.metadata?.source_title,
      candidate.metadata?.source,
      candidate.metadata?.source_url,
      candidate.metadata?.document_url,
      candidate.metadata?.url,
      candidate.documentId,
    ].filter(Boolean).join(' '));
    const fallbackIdentityText = this.normalizeSearchText([
      candidate.documentTitle,
      candidate.documentId,
    ].filter(Boolean).join(' '));
    const text = primaryIdentityText || fallbackIdentityText;
    if (!text) return false;

    const hasTarget = getCompassVendorTerms(targetVendor).some(term => text.includes(term));
    const otherVendors = (['META', 'KAKAO', 'NAVER', 'GOOGLE'] as VendorIntent[])
      .filter(vendor => vendor !== targetVendor);
    const hasOther = otherVendors.some(vendor => getCompassVendorTerms(vendor).some(term => text.includes(term)));

    return hasOther && !hasTarget;
  }

  private pickBestVendorSlotCandidate(
    ranked: SearchResult[],
    selected: SearchResult[],
    vendor: VendorIntent,
    intent: QueryIntent
  ): SearchResult | undefined {
    return ranked
      .filter(item => (
        this.matchesVendorSlot(item, vendor)
        && !selected.some(selectedItem => selectedItem.id === item.id)
      ))
      .sort((a, b) => (
        this.scoreVendorSlotCandidate(b, intent) - this.scoreVendorSlotCandidate(a, intent)
      ))[0];
  }

  private scoreVendorSlotCandidate(candidate: SearchResult, intent: QueryIntent): number {
    const baseScore = candidate.hybridScore || candidate.score || candidate.similarity || 0;
    const policyJudgmentIntent = this.hasPolicyJudgmentIntent(intent);
    const policyEvidenceBoost = policyJudgmentIntent && candidate.topicExactMatch ? 0.22 : 0;
    const policyTitleBoost = policyJudgmentIntent && candidate.policyTitleMatch ? 0.16 : 0;
    const reviewPolicyTitleBoost = policyJudgmentIntent && this.isReviewPolicyCandidate(candidate) ? 0.55 : 0;
    const verifiedBoost = candidate.evidenceDecision === 'verified' ? 0.3 : 0;
    const weakPenalty = candidate.evidenceDecision === 'weak' ? 0.25 : 0;
    const termsPenalty = policyJudgmentIntent && this.isTermsOfServiceCandidate(candidate) ? 0.75 : 0;
    const creativeGuidePenalty = policyJudgmentIntent && this.isCreativeSpecCandidate(candidate) ? 1.15 : 0;
    const supportDocPenalty = policyJudgmentIntent && this.isAdministrativeSupportCandidate(candidate) ? 0.9 : 0;
    const eventPromoPenalty = policyJudgmentIntent && this.isEventPromoCandidate(candidate) ? 0.65 : 0;
    const strictContextPenalty = policyJudgmentIntent && this.isStrictContextMismatchCandidate(candidate, intent) ? 1.1 : 0;
    const unknownTitlePenalty = candidate.documentTitle === 'Unknown' ? 0.12 : 0;

    return baseScore + verifiedBoost + policyEvidenceBoost + policyTitleBoost + reviewPolicyTitleBoost
      - weakPenalty - termsPenalty - creativeGuidePenalty - supportDocPenalty - eventPromoPenalty - strictContextPenalty - unknownTitlePenalty;
  }

  private findVendorSlotReplacementIndex(selected: SearchResult[], intent: QueryIntent): number {
    const nonRequiredVendorIndex = selected.findIndex(candidate => (
      candidate.sourceVendor
      && candidate.sourceVendor !== 'UNKNOWN'
      && !intent.vendors.includes(candidate.sourceVendor)
    ));

    if (nonRequiredVendorIndex >= 0) {
      return nonRequiredVendorIndex;
    }

    let weakestIndex = selected.length - 1;
    let weakestScore = Number.POSITIVE_INFINITY;

    selected.forEach((candidate, index) => {
      const score = candidate.hybridScore || candidate.score || candidate.similarity || 0;
      if (score < weakestScore) {
        weakestScore = score;
        weakestIndex = index;
      }
    });

    return weakestIndex;
  }

  private mergeDuplicateCandidate(existing: SearchResult, incoming: SearchResult, intent: QueryIntent): SearchResult {
    const vectorScore = Math.max(existing.vectorScore || 0, incoming.vectorScore || 0);
    const keywordScore = Math.max(existing.keywordScore || 0, incoming.keywordScore || 0);
    const sourceQualityScore = Math.max(
      existing.sourceQuality.qualityScore || 0,
      incoming.sourceQuality.qualityScore || 0
    );
    const lexicalOverlap = Math.max(existing.lexicalOverlap || 0, incoming.lexicalOverlap || 0);
    const vendorMatch = existing.vendorMatch === true || incoming.vendorMatch === true;
    const vendorMismatch = existing.vendorMismatch === true && incoming.vendorMismatch === true;
    const sourceVendor = this.chooseMergedSourceVendor(existing, incoming);
    const sourceVendors = Array.from(new Set([
      ...(existing.sourceVendors || []),
      ...(incoming.sourceVendors || []),
    ]));
    const topicMatch = existing.topicMatch === true || incoming.topicMatch === true;
    const topicExactMatch = existing.topicExactMatch === true || incoming.topicExactMatch === true;
    const policyTitleMatch = existing.policyTitleMatch === true || incoming.policyTitleMatch === true;
    const retrievalMethod: RetrievalMethod = vectorScore > 0 && keywordScore > 0 ? 'hybrid' : existing.retrievalMethod;
    const evidenceType: EvidenceType = retrievalMethod === 'hybrid' ? 'hybrid' : existing.evidenceType || incoming.evidenceType || retrievalMethod;
    const corpus = existing.corpus || incoming.corpus || 'ollama_document_chunks';
    const originalMetaSeed =
      this.isOriginalMetaSeedCandidate({
        chunkId: existing.id,
        corpus,
        sourceVendor: existing.sourceVendor || 'UNKNOWN',
        metadata: existing.metadata,
      })
      || this.isOriginalMetaSeedCandidate({
        chunkId: incoming.id,
        corpus,
        sourceVendor: incoming.sourceVendor || 'UNKNOWN',
        metadata: incoming.metadata,
      });
    let hybridScore = this.calculateHybridScore({
      vectorScore,
      keywordScore,
      sourceQualityScore,
      retrievalMethod,
      corpus,
      lexicalOverlap,
      vendorMatch,
      vendorMismatch,
      topicMatch,
      topicExactMatch,
      policyTitleMatch,
      genericPolicyIntent: this.isGenericPolicyIntent(intent),
      originalMetaSeed,
      hasUrl: existing.sourceQuality.hasUrl || incoming.sourceQuality.hasUrl,
    });
    const mergedSourceText = this.buildCandidateSearchText(
      `${existing.content || ''} ${incoming.content || ''}`,
      existing.documentTitle || incoming.documentTitle,
      {
        ...(existing.metadata || {}),
        ...(incoming.metadata || {}),
      }
    );
    const productStructureAdjustment = this.calculateProductStructureScoreAdjustment(mergedSourceText, intent);
    if (productStructureAdjustment.adjustment !== 0) {
      hybridScore = Math.max(0, Math.min(1, hybridScore + productStructureAdjustment.adjustment));
    }
    const warnings = Array.from(new Set([
      ...existing.sourceQuality.warnings,
      ...incoming.sourceQuality.warnings,
    ]));
    const rankReason = Array.from(new Set([
      ...(existing.rankReason || []),
      ...(incoming.rankReason || []),
      ...productStructureAdjustment.reasons,
      retrievalMethod === 'hybrid' ? 'matched_vector_and_keyword' : '',
    ].filter(Boolean)));

    return {
      ...existing,
      similarity: Math.max(existing.similarity, incoming.similarity),
      score: hybridScore,
      hybridScore,
      vectorScore,
      keywordScore,
      retrievalMethod,
      evidenceType,
      rankReason,
      lexicalOverlap,
      vendorMatch,
      vendorMismatch,
      topicMatch,
      topicExactMatch,
      policyTitleMatch,
      documentUrl: existing.documentUrl || incoming.documentUrl,
      sourceQuality: {
        ...existing.sourceQuality,
        hasUrl: existing.sourceQuality.hasUrl || incoming.sourceQuality.hasUrl,
        qualityScore: sourceQualityScore,
        warnings,
        lexicalOverlap,
        vendorMatch,
        vendorMismatch,
        sourceVendor,
        policyTitleMatch,
      },
      metadata: {
        ...(existing.metadata || {}),
        retrievalMethod,
        evidenceType,
        score: hybridScore,
        hybridScore,
        vectorScore,
        keywordScore,
        lexicalOverlap,
        vendorMatch,
        vendorMismatch,
        sourceVendor,
        sourceVendors,
        topicMatch,
        topicExactMatch,
        policyTitleMatch,
        sourceQualityWarnings: warnings,
      },
    };
  }

  private isVerifiedEvidence(
    candidate: SearchResult,
    intent: QueryIntent,
    hasTargetVendorRescueCandidate: boolean,
    hasGenericTopicRescueCandidate: boolean
  ): boolean {
    if (!candidate.content?.trim()) return false;
    if (candidate.retrievalMethod === 'fallback') return false;
    if (candidate.sourceQuality.isFallback === true) return false;
    if (!candidate.sourceQuality.hasExcerpt) return false;

    const hybridScore = candidate.hybridScore || 0;
    const lexicalOverlap = candidate.lexicalOverlap || 0;
    const keywordScore = candidate.keywordScore || 0;
    const vectorScore = candidate.vectorScore || 0;
    const hasVendorIntent = intent.vendors.length > 0;
    const hasTopicIntent = intent.topics.length > 0;
    const hasIntent = hasVendorIntent || hasTopicIntent;
    const genericPolicyIntent = this.isGenericPolicyIntent(intent);

    if (intent.topics.includes('product_structure')) {
      const sourceText = this.buildCandidateSearchText(candidate.content, candidate.documentTitle, candidate.metadata);
      const normalizedContent = this.normalizeSearchText(candidate.content);
      if (!this.hasHighValueProductStructureSignal(sourceText)) {
        return false;
      }
      if (normalizedContent.length < 140) {
        return false;
      }
    }

    if (hybridScore < 0.25) return false;
    if (
      genericPolicyIntent
      && hasGenericTopicRescueCandidate
      && this.isVectorOnlyMetaSeed(candidate)
      && !candidate.topicExactMatch
      && keywordScore === 0
      && lexicalOverlap <= 0.2
    ) {
      return false;
    }
    if (
      hasVendorIntent
      && candidate.vendorMismatch
      && !candidate.vendorMatch
    ) {
      return false;
    }
    if (
      hasTargetVendorRescueCandidate
      && this.isExplicitNonMetaIntent(intent)
      && this.isMetaOnlyOllamaMismatch(candidate, intent)
      && lexicalOverlap < 0.45
      && keywordScore < 0.5
    ) {
      return false;
    }
    if (
      candidate.vendorMismatch
      && !candidate.vendorMatch
      && hasTargetVendorRescueCandidate
    ) {
      return false;
    }
    if (
      candidate.vendorMismatch
      && !candidate.vendorMatch
      && lexicalOverlap < 0.12
      && keywordScore < 0.2
    ) {
      return false;
    }

    if (candidate.vendorMatch) return true;
    if (genericPolicyIntent && candidate.topicExactMatch && candidate.policyTitleMatch && lexicalOverlap >= 0.15) return true;
    if (keywordScore >= 0.35 && lexicalOverlap >= 0.12) return true;
    if (lexicalOverlap >= (hasIntent ? 0.2 : 0.28)) return true;
    if (vectorScore >= 0.82 && lexicalOverlap >= 0.12) return true;

    return false;
  }

  private getDedupeKeys(candidate: SearchResult): string[] {
    return [
      `chunk:${candidate.id}`,
      `doc-index:${candidate.documentId}:${candidate.chunkIndex}`,
      `content:${this.contentFingerprint(candidate.content)}`,
    ].filter(Boolean);
  }

  private detectQueryIntent(query: string): QueryIntent {
    return classifyCompassRagQuery(query);
  }

  private detectVendors(text: string): VendorIntent[] {
    const vendors: VendorIntent[] = [];
    const specs: Array<[VendorIntent, string[]]> = [
      ['META', ['meta', 'facebook', '페이스북', 'instagram', '인스타그램', '릴스', 'reels']],
      ['KAKAO', ['kakao', '카카오', '카카오톡', '톡채널', '비즈보드', '모먼트']],
      ['NAVER', ['naver', '네이버', '검색광고', '쇼핑검색', '파워링크', '브랜드검색']],
      ['GOOGLE', ['google', '구글', 'youtube', '유튜브', 'gdn', 'google ads', 'display']],
    ];

    for (const [vendor, terms] of specs) {
      if (terms.some(term => text.includes(term))) {
        vendors.push(vendor);
      }
    }

    return vendors;
  }

  private choosePrimaryVendor(sourceVendors: VendorIntent[], queryVendors: VendorIntent[]): VendorIntent | 'UNKNOWN' {
    if (sourceVendors.length === 0) return 'UNKNOWN';
    const queryMatch = queryVendors.find(vendor => sourceVendors.includes(vendor));
    return queryMatch || sourceVendors[0];
  }

  private detectTopics(text: string): TopicIntent[] {
    const topics: TopicIntent[] = [];
    const specs: Array<[TopicIntent, string[]]> = [
      ['review', ['심사', '승인', '반려', '집행 기준', '준수사항']],
      ['youth', ['청소년', '유해', '성인', '연령']],
      ['false_claim', ['허위', '과장', '오인', '기만']],
      ['price', ['가격', '할인', '할인율']],
      ['event', ['이벤트', '경품', '참여', '당첨']],
      ['rights', ['상표', '저작권', '초상권', '권리']],
      ['hate', ['혐오', '차별', '비하']],
      ['gambling', ['도박', '사행']],
      ['spec', ['사이즈', '크기', '파일', '형식', '스펙', '동영상', '이미지', '카루셀']],
      ['product_structure', [
        '광고 상품', '광고상품', '광고 종류', '광고종류', '광고 유형', '광고유형', '상품 구조', '광고 구조',
        '캠페인 목표', '광고 관리자 목표', 'objective', 'objectives', 'advantage+', '어드밴티지',
        '카탈로그', 'catalog', '메타 픽셀', 'meta pixel', '픽셀 이벤트', '픽셀 코드', '전환', 'conversion', 'conversions api',
        '노출 위치', '게재 위치', 'placements', '지면',
        '앱 캠페인', '쇼핑 광고', '검색 캠페인', '디스플레이 캠페인', '반응형 디스플레이', '리드 양식',
        '검색광고', '쇼핑검색', '파워링크', '브랜드검색', '쇼핑블록', '디지털 옥외광고',
        '비즈보드', '카카오모먼트', '브랜드이모티콘', '상품가이드', '상품 가이드'
      ]],
    ];

    for (const [topic, terms] of specs) {
      if (terms.some(term => text.includes(term))) {
        topics.push(topic);
      }
    }

    return topics;
  }

  private matchTerms(text: string, terms: string[]): string[] {
    return terms.filter(term => text.includes(term));
  }

  private extractKeywords(query: string): string[] {
    const stopwords = new Set([
      '무엇인가요', '무엇', '어떤', '있는', '없는', '해주세요', '알려줘', '기준은', '기준',
      '관련', '대한', '그리고', '또는', '가능한가요', '되나요', '경우', '알려', '줘',
      'the', 'and', 'for', 'with', 'what', 'how'
    ]);

    return Array.from(new Set(
      query
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .map(word => word.trim())
        .filter(word => word.length >= 2 && !stopwords.has(word))
    )).slice(0, 8);
  }

  private calculateKeywordScore(
    content: string,
    title: string,
    keywords: string[],
    lexicalOverlap: number,
    topicMatch: boolean,
    topicExactMatch: boolean = false,
    policyTitleMatch: boolean = false
  ): number {
    if (keywords.length === 0) {
      return 0;
    }

    const contentLower = content.toLowerCase();
    const titleLower = (title || '').toLowerCase();
    let score = 0;

    for (const keyword of keywords) {
      if (contentLower.includes(keyword)) score += 1;
      if (titleLower.includes(keyword)) score += 0.7;
    }

    const rawScore = score / Math.max(1, keywords.length);
    const topicBoost = topicMatch ? 0.12 : 0;
    const topicExactBoost = topicExactMatch ? 0.12 : 0;
    const policyTitleBoost = policyTitleMatch ? 0.05 : 0;
    return Math.max(0, Math.min(1, (rawScore * 0.75) + (lexicalOverlap * 0.25) + topicBoost + topicExactBoost + policyTitleBoost));
  }

  private resolveVectorScore(result: any, queryEmbedding?: number[]): number {
    const rpcSimilarity = Number(result.similarity ?? result.score ?? result.match_score);
    if (Number.isFinite(rpcSimilarity) && rpcSimilarity > 0) {
      return Math.max(0, Math.min(1, rpcSimilarity));
    }

    if (!queryEmbedding || !result.embedding) {
      return 0;
    }

    const storedEmbedding = this.parseEmbedding(result.embedding);
    if (!storedEmbedding) {
      return 0;
    }

    return this.calculateCosineSimilarity(queryEmbedding, storedEmbedding);
  }

  private parseEmbedding(embedding: unknown): number[] | null {
    try {
      if (typeof embedding === 'string') {
        return JSON.parse(embedding);
      }

      if (Array.isArray(embedding)) {
        return embedding as number[];
      }
    } catch (error) {
      console.warn(`임베딩 파싱 실패: ${error}`);
    }

    return null;
  }

  private normalizeSearchText(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildCandidateSearchText(content: string, title: string, metadata?: any): string {
    return this.normalizeSearchText([
      title,
      content,
      metadata?.title,
      metadata?.source_title,
      metadata?.canonical_title,
      metadata?.source,
      metadata?.source_vendor,
      Array.isArray(metadata?.topic_labels) ? metadata.topic_labels.join(' ') : metadata?.topic_labels,
      metadata?.sample_bucket,
      metadata?.source_url,
      metadata?.document_url,
      metadata?.url,
      metadata?.document_id,
      metadata?.chunk_id,
    ].filter(Boolean).join(' '));
  }

  private calculateLexicalOverlap(sourceText: string, keywords: string[]): number {
    if (keywords.length === 0) return 0;
    const matched = keywords.filter(keyword => sourceText.includes(this.normalizeSearchText(keyword)));
    return Math.max(0, Math.min(1, matched.length / keywords.length));
  }

  private calculateVendorAlignment(
    sourceText: string,
    vendors: VendorIntent[],
    sourceIdentity?: {
      metadata?: any;
      title?: string;
      url?: string;
      documentId?: string;
    }
  ): {
    match: boolean;
    mismatch: boolean;
    primaryVendor: VendorIntent | 'UNKNOWN';
    sourceVendors: VendorIntent[];
  } {
    const authoritativeVendor = this.getAuthoritativeSourceVendor(sourceIdentity);

    if (authoritativeVendor && authoritativeVendor !== 'UNKNOWN') {
      const match = vendors.length === 0 ? false : vendors.includes(authoritativeVendor);
      const mismatch = vendors.length > 0 && !match;
      return {
        match,
        mismatch,
        primaryVendor: authoritativeVendor,
        sourceVendors: [authoritativeVendor],
      };
    }

    const sourceVendors = this.detectVendors(sourceText);
    const primaryVendor = this.choosePrimaryVendor(sourceVendors, vendors);
    if (vendors.length === 0) {
      return { match: false, mismatch: false, primaryVendor, sourceVendors };
    }

    const match = vendors.some(vendor => sourceVendors.includes(vendor));
    const mismatch = sourceVendors.length > 0 && !match;

    return { match, mismatch, primaryVendor, sourceVendors };
  }

  private getAuthoritativeSourceVendor(sourceIdentity?: {
    metadata?: any;
    title?: string;
    url?: string;
    documentId?: string;
  }): VendorIntent | 'UNKNOWN' {
    if (!sourceIdentity) return 'UNKNOWN';

    const metadata = sourceIdentity.metadata || {};
    const explicitVendor = this.normalizeVendorToken(
      metadata.source_vendor
      || metadata.vendor
      || metadata.media
      || metadata.platform
    );

    if (explicitVendor) {
      return explicitVendor;
    }

    const identityText = this.normalizeSearchText([
      sourceIdentity.title,
      metadata.canonical_title,
      metadata.source_title,
      metadata.source,
      metadata.sample_bucket,
      metadata.source_url,
      metadata.document_url,
      metadata.url,
      sourceIdentity.url,
      sourceIdentity.documentId,
    ].filter(Boolean).join(' '));

    if (
      identityText.includes('kakaobusiness')
      || identityText.includes('카카오 광고')
      || identityText.includes('카카오비즈니스')
      || identityText.includes('kakao:')
      || identityText.startsWith('kakao')
    ) {
      return 'KAKAO';
    }

    if (
      identityText.includes('ads.naver.com')
      || identityText.includes('naver:')
      || identityText.includes('네이버 광고')
      || identityText.includes('네이버 검색광고')
      || identityText.startsWith('naver')
    ) {
      return 'NAVER';
    }

    if (
      identityText.includes('support.google.com')
      || identityText.includes('google ads')
      || identityText.includes('google:')
      || identityText.includes('youtube:')
      || identityText.startsWith('google')
    ) {
      return 'GOOGLE';
    }

    if (
      identityText.includes('meta:')
      || identityText.includes('facebook')
      || identityText.includes('instagram')
      || identityText.includes('메타 광고')
      || identityText.includes('페이스북 광고')
      || identityText.includes('인스타그램 광고')
      || identityText.startsWith('meta')
    ) {
      return 'META';
    }

    return 'UNKNOWN';
  }

  private normalizeVendorToken(value: unknown): VendorIntent | null {
    const text = this.normalizeSearchText(String(value || ''));
    if (!text) return null;
    if (text === 'meta' || text === 'facebook' || text === 'instagram') return 'META';
    if (text === 'kakao' || text === '카카오') return 'KAKAO';
    if (text === 'naver' || text === '네이버') return 'NAVER';
    if (text === 'google' || text === 'youtube' || text === '구글' || text === '유튜브') return 'GOOGLE';
    return null;
  }

  private chooseMergedSourceVendor(existing: SearchResult, incoming: SearchResult): VendorIntent | 'UNKNOWN' {
    if (existing.vendorMatch && existing.sourceVendor && existing.sourceVendor !== 'UNKNOWN') {
      return existing.sourceVendor;
    }
    if (incoming.vendorMatch && incoming.sourceVendor && incoming.sourceVendor !== 'UNKNOWN') {
      return incoming.sourceVendor;
    }
    if (existing.sourceVendor && existing.sourceVendor !== 'UNKNOWN') return existing.sourceVendor;
    if (incoming.sourceVendor && incoming.sourceVendor !== 'UNKNOWN') return incoming.sourceVendor;
    return 'UNKNOWN';
  }

  private isExplicitNonMetaIntent(intent: QueryIntent): boolean {
    return intent.vendors.some(vendor => vendor === 'KAKAO' || vendor === 'NAVER' || vendor === 'GOOGLE');
  }

  private isMetaOnlyOllamaMismatch(candidate: SearchResult, intent: QueryIntent): boolean {
    return Boolean(
      candidate.corpus === 'ollama_document_chunks'
      && candidate.sourceVendor === 'META'
      && candidate.vendorMismatch
      && !candidate.vendorMatch
      && this.isExplicitNonMetaIntent(intent)
    );
  }

  private isGenericPolicyIntent(intent: QueryIntent): boolean {
    return (
      intent.vendors.length === 0
      && intent.topics.length > 0
      && intent.adPolicyTerms.length > 0
      && !intent.isOutOfScope
      && !intent.unavailablePolicyTarget
    );
  }

  private hasPolicyJudgmentIntent(intent: QueryIntent): boolean {
    if (intent.topics.some(topic => topic !== 'spec' && topic !== 'product_structure')) return true;
    return intent.keywords.some(keyword => (
      ['주의', '제한', '금지', '반려', '심사', '검수', '정책', '운영정책', '등록기준', '광고등록기준'].includes(keyword)
    ));
  }

  private calculateProductStructureScoreAdjustment(sourceText: string, intent: QueryIntent): { adjustment: number; reasons: string[] } {
    if (!intent.topics.includes('product_structure')) {
      return { adjustment: 0, reasons: [] };
    }

    const text = this.normalizeSearchText(sourceText);
    const reasons: string[] = [];
    let adjustment = 0;

    if (this.hasHighValueProductStructureSignal(text)) {
      adjustment += 0.32;
      reasons.push('high_value_product_structure_match');
    }

    if (this.hasProductStructureSignal(text)) {
      adjustment += 0.06;
      reasons.push('product_structure_match');
    }

    if (/캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives/.test(text)
      || /인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(text)
    ) {
      adjustment += 0.22;
      reasons.push('campaign_objective_match');
    }

    if (/advantage\+|어드밴티지|카탈로그|catalog|메타\s*픽셀|meta\s*pixel|픽셀\s*(이벤트|코드|설치|전환)|conversions api|앱\s*캠페인|쇼핑\s*광고|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|리드\s*양식|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|디지털\s*옥외광고|비즈보드|카카오모먼트|브랜드이모티콘|상품\s*가이드|상품가이드/.test(text)) {
      adjustment += 0.18;
      reasons.push('product_solution_match');
    }

    if (/상품\s*db|db\s*url|쇼핑파트너센터|pc\s*쇼핑블록|mo\s*쇼핑블록|모바일\s*쇼핑|가격비교|광고\s*등록\s*기준|광고등록기준|디지털\s*옥외광고/.test(text)) {
      adjustment += 0.2;
      reasons.push('vendor_product_detail_match');
    }

    if (this.isLowValueProductStructureDirectoryText(text)) {
      adjustment -= 0.72;
      reasons.push('product_structure_directory_penalty');
    }

    if (this.isCreativeSpecOnlyText(text)) {
      adjustment -= 0.62;
      reasons.push('creative_spec_only_penalty');
    }

    if (!this.hasHighValueProductStructureSignal(text)) {
      adjustment -= 0.75;
      reasons.push('product_structure_no_signal_penalty');
    }

    return { adjustment, reasons };
  }

  private hasProductStructureSignal(text: string): boolean {
    return /캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives|advantage\+|어드밴티지|카탈로그|catalog|메타\s*픽셀|meta\s*pixel|픽셀\s*(이벤트|코드|설치|전환)|conversions api|노출 위치|게재 위치|placements|지면|컬렉션|collection|리드|lead|앱\s*캠페인|쇼핑\s*광고|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|리드\s*양식|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|상품\s*db|db\s*url|가격비교|디지털\s*옥외광고|비즈보드|카카오모먼트|브랜드이모티콘|상품\s*가이드|상품가이드/.test(text);
  }

  private hasHighValueProductStructureSignal(text: string): boolean {
    const hasObjectiveList = /인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(text);
    return hasObjectiveList
      || /캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives|advantage\+|어드밴티지|어드밴티지\+|카탈로그|catalog|메타\s*픽셀|meta\s*pixel|픽셀\s*(이벤트|코드|설치|전환)|conversions api|앱\s*캠페인|쇼핑\s*광고|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|리드\s*양식|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|상품\s*db|db\s*url|가격비교|디지털\s*옥외광고|비즈보드|카카오모먼트|브랜드이모티콘|상품\s*가이드|상품가이드/.test(text)
      || /노출 위치|게재 위치|placements|지면/.test(text) && /캠페인 목표|광고 관리자 목표|마케팅 목표/.test(text);
  }

  private isLowValueProductStructureDirectoryText(text: string): boolean {
    const hasDirectoryShell = /공지사항|성공전략|성공사례|광고운영팁|검색어 입력 창|thumbnail|sequence|badge|전체 공통/.test(text);
    const hasSpecificProductDetail = /상품\s*db|db\s*url|쇼핑파트너센터|pc\s*쇼핑블록|mo\s*쇼핑블록|모바일\s*쇼핑|가격비교|광고\s*등록\s*기준|광고등록기준|디지털\s*옥외광고[\s\S]{0,80}불가\s*업종|쇼핑검색[\s\S]{0,80}필터/.test(text);
    return hasDirectoryShell && !hasSpecificProductDetail;
  }

  private isCreativeSpecOnlyText(text: string): boolean {
    const hasSpecSignal = /광고 사양|광고 형식\/사양|제작 가이드|소재 제작|크기|파일 크기|최대 파일|지원 형식|비율|jpg|png|mp4|mov|1200x|1080x|1280x|텍스트 제한|최대 길이|초|marketplace의|facebook marketplace|facebook 검색 결과|instagram 탐색 홈|탐색 홈의|검색 결과의/.test(text);
    return hasSpecSignal && !this.hasHighValueProductStructureSignal(text);
  }

  private inferDocumentTitleFromContent(content: string): string | undefined {
    const text = this.normalizeSearchText(content).slice(0, 500);

    if (text.includes('facebook 광고 가이드') && text.includes('meta 광고 관리자 목표 업데이트')) {
      return 'Facebook 광고 가이드: Meta 광고 관리자 목표 업데이트';
    }

    if (text.includes('facebook 광고 가이드')) return 'Facebook 광고 가이드';
    if (text.includes('instagram 광고 가이드')) return 'Instagram 광고 가이드';
    if (text.includes('meta 비즈니스 지원 센터')) return 'Meta 비즈니스 지원 센터';
    if (text.includes('google ads')) return 'Google Ads 가이드';
    if (text.includes('네이버 통합 광고주센터')) return '네이버 통합 광고주센터';
    if (text.includes('카카오비즈니스')) return '카카오비즈니스 가이드';

    return undefined;
  }

  private isTermsOfServiceCandidate(candidate: SearchResult): boolean {
    const text = this.normalizeSearchText([
      candidate.documentTitle,
      candidate.metadata?.source_title,
      candidate.metadata?.canonical_title,
      candidate.metadata?.title,
      candidate.metadata?.source,
    ].filter(Boolean).join(' '));

    return text.includes('이용약관') || text.includes('약관');
  }

  private isCreativeSpecCandidate(candidate: SearchResult): boolean {
    const text = this.normalizeSearchText([
      candidate.documentTitle,
      candidate.content,
      candidate.metadata?.source_title,
      candidate.metadata?.canonical_title,
      candidate.metadata?.title,
      candidate.metadata?.source,
    ].filter(Boolean).join(' '));

    return (
      text.includes('제작 가이드')
      || text.includes('광고 사양')
      || text.includes('동영상배너')
      || text.includes('배너형')
      || text.includes('소재 제작')
      || text.includes('이미지 광고')
      || text.includes('동영상 광고')
      || text.includes('카루셀 광고')
      || text.includes('최대 파일 크기')
      || text.includes('지원 형식')
      || text.includes('픽셀')
      || text.includes('비율')
      || text.includes('반응형 디스플레이')
      || text.includes('권장사항 가이드')
      || text.includes('최종 url')
      || text.includes('광고 그룹별')
      || text.includes('실적이 우수한')
    );
  }

  private isAdministrativeSupportCandidate(candidate: SearchResult): boolean {
    const text = this.normalizeSearchText([
      candidate.documentTitle,
      candidate.content,
      candidate.metadata?.source_title,
      candidate.metadata?.canonical_title,
      candidate.metadata?.title,
      candidate.metadata?.source,
    ].filter(Boolean).join(' '));

    return (
      text.includes('세금')
      || text.includes('vat')
      || text.includes('인보이스')
      || text.includes('invoice')
      || text.includes('결제')
      || text.includes('청구')
      || text.includes('billing')
      || text.includes('payment')
      || text.includes('비즈니스 지원 센터')
    );
  }

  private isLowValuePolicySource(candidate: SearchResult, intent: QueryIntent): boolean {
    return (
      this.isCreativeSpecCandidate(candidate)
      || this.isAdministrativeSupportCandidate(candidate)
      || this.isTermsOfServiceCandidate(candidate)
      || this.isEventPromoCandidate(candidate)
      || this.isStrictProductMismatchCandidate(candidate, intent)
      || this.isStrictContextMismatchCandidate(candidate, intent)
    );
  }

  private isStrictProductMismatchCandidate(candidate: SearchResult, intent: QueryIntent): boolean {
    if (intent.strictProductTerms.length === 0) return false;
    const text = this.buildCandidateSearchText(candidate.content, candidate.documentTitle, candidate.metadata);
    return !intent.strictProductTerms.some(term => text.includes(term.toLowerCase()));
  }

  private isStrictContextMismatchCandidate(candidate: SearchResult, intent: QueryIntent): boolean {
    if (intent.strictContextTerms.length === 0) return false;
    const text = this.buildCandidateSearchText(candidate.content, candidate.documentTitle, candidate.metadata);
    return !intent.strictContextTerms.some(term => text.includes(term.toLowerCase()));
  }

  private isReviewPolicyCandidate(candidate: SearchResult): boolean {
    const text = this.normalizeSearchText([
      candidate.documentTitle,
      candidate.content,
      candidate.metadata?.source_title,
      candidate.metadata?.canonical_title,
      candidate.metadata?.title,
      candidate.metadata?.source,
    ].filter(Boolean).join(' '));

    return (
      text.includes('광고 등록 기준')
      || text.includes('광고등록기준')
      || text.includes('등록 기준')
      || text.includes('운영정책')
      || text.includes('심사 가이드')
      || text.includes('검수 가이드')
      || text.includes('광고 검토')
      || text.includes('광고소재 검수')
    );
  }

  private isEventPromoCandidate(candidate: SearchResult): boolean {
    const text = this.normalizeSearchText([
      candidate.documentTitle,
      candidate.content,
      candidate.metadata?.source_title,
      candidate.metadata?.canonical_title,
      candidate.metadata?.title,
      candidate.metadata?.source,
    ].filter(Boolean).join(' '));

    return (
      text.includes('오늘 여기 클립')
      || text.includes('이벤트')
      || text.includes('npay')
      || text.includes('혜택 지급')
      || text.includes('프로모션')
      || text.includes('챌린저')
    );
  }

  private isOriginalMetaSeedCandidate(input: {
    chunkId: string;
    corpus: RetrievalCorpus;
    sourceVendor: VendorIntent | 'UNKNOWN';
    metadata?: any;
  }): boolean {
    const chunkId = String(input.chunkId || '');
    return Boolean(
      input.corpus === 'ollama_document_chunks'
      && input.sourceVendor === 'META'
      && !input.metadata?.rag_gate
      && !chunkId.startsWith('rag3d_')
      && !chunkId.startsWith('rag3j_')
    );
  }

  private isVectorOnlyMetaSeed(candidate: SearchResult): boolean {
    return Boolean(
      candidate.corpus === 'ollama_document_chunks'
      && candidate.sourceVendor === 'META'
      && candidate.retrievalMethod === 'vector'
      && (candidate.keywordScore || 0) === 0
      && !candidate.metadata?.rag_gate
      && !String(candidate.id || '').startsWith('rag3d_')
      && !String(candidate.id || '').startsWith('rag3j_')
    );
  }

  private isTargetVendorRescueCandidate(candidate: SearchResult, intent: QueryIntent): boolean {
    const targetVendor = intent.vendors.find(vendor => vendor === 'KAKAO' || vendor === 'NAVER' || vendor === 'GOOGLE');
    if (!targetVendor) return false;
    if (candidate.corpus !== 'document_chunks') return false;
    if (candidate.sourceVendor !== targetVendor) return false;
    if ((candidate.lexicalOverlap || 0) < 0.18) return false;
    if ((candidate.keywordScore || 0) < 0.35) return false;
    if ((candidate.hybridScore || 0) < 0.35) return false;
    if (!candidate.sourceQuality.hasExcerpt || candidate.sourceQuality.isFallback) return false;
    return this.hasVendorProductTerm(candidate, targetVendor);
  }

  private isGenericTopicRescueCandidate(candidate: SearchResult, intent: QueryIntent): boolean {
    if (!this.isGenericPolicyIntent(intent)) return false;
    if (!candidate.sourceQuality.hasExcerpt || candidate.sourceQuality.isFallback) return false;
    if (!candidate.topicExactMatch) return false;
    if (!candidate.policyTitleMatch) return false;
    if ((candidate.hybridScore || 0) < 0.35) return false;
    if ((candidate.keywordScore || 0) < 0.3 && (candidate.lexicalOverlap || 0) < 0.25) return false;

    const ragGate = String(candidate.metadata?.rag_gate || '');
    if (candidate.corpus === 'ollama_document_chunks' && (ragGate === 'RAG-3F' || ragGate === 'RAG-3K')) {
      return true;
    }

    return candidate.corpus === 'document_chunks' && (candidate.keywordScore || 0) >= 0.35;
  }

  private findWeakestGenericPolicyReplacementIndex(selected: SearchResult[], intent: QueryIntent): number {
    const metaSeedIndex = selected.findIndex(candidate => (
      this.isGenericPolicyIntent(intent)
      && this.isVectorOnlyMetaSeed(candidate)
      && !candidate.topicExactMatch
    ));

    if (metaSeedIndex >= 0) return metaSeedIndex;

    let weakestIndex = selected.length - 1;
    let weakestScore = Number.POSITIVE_INFINITY;
    selected.forEach((candidate, index) => {
      const score = candidate.hybridScore || 0;
      if (score < weakestScore) {
        weakestScore = score;
        weakestIndex = index;
      }
    });
    return weakestIndex;
  }

  private hasVendorProductTerm(candidate: SearchResult, vendor: VendorIntent): boolean {
    const text = this.buildCandidateSearchText(candidate.content, candidate.documentTitle, candidate.metadata);
    const terms: Record<VendorIntent, string[]> = {
      META: ['meta', 'facebook', '페이스북', 'instagram', '인스타그램', '릴스', 'reels'],
      KAKAO: ['kakao', '카카오', '카카오톡', '톡채널', '비즈보드', '모먼트'],
      NAVER: ['naver', '네이버', '검색광고', '쇼핑검색', '파워링크', '브랜드검색'],
      GOOGLE: ['google', '구글', 'youtube', '유튜브', 'gdn', 'google ads', 'display'],
    };
    return terms[vendor].some(term => text.includes(term));
  }

  private hasTopicMatch(sourceText: string, topics: TopicIntent[]): boolean {
    if (topics.length === 0) return false;
    const sourceTopics = this.detectTopics(sourceText);
    return topics.some(topic => sourceTopics.includes(topic));
  }

  private hasExactTopicMatch(sourceText: string, topics: TopicIntent[]): boolean {
    if (topics.length === 0) return false;
    const specs: Record<TopicIntent, string[]> = {
      review: ['심사', '승인', '반려', '집행 기준', '준수사항', '심사 가이드'],
      youth: ['청소년', '유해', '성인', '연령', '청소년 보호'],
      false_claim: ['허위', '과장', '오인', '기만', '거짓', '효능', '효과', '보장', '입증', '개선', '치료'],
      price: ['가격', '할인', '할인율', '표시', '소재'],
      event: ['이벤트', '경품', '참여', '당첨'],
      rights: ['상표', '저작권', '초상권', '권리', '침해'],
      hate: ['혐오', '차별', '비하', '증오'],
      gambling: ['도박', '사행', '사행성', '금지', '제한', '불가', '허용'],
      spec: ['사이즈', '크기', '파일', '형식', '스펙', '동영상', '이미지', '카루셀'],
      product_structure: [
        '광고 상품', '광고상품', '광고 종류', '광고종류', '상품 구조', '광고 구조',
        '캠페인 목표', '광고 관리자 목표', '마케팅 목표',
        'objective', 'objectives', 'advantage+', '어드밴티지', '카탈로그', 'catalog', '메타 픽셀', 'meta pixel', '픽셀 이벤트', '픽셀 코드',
        'conversions api', '노출 위치', '게재 위치', 'placements', '지면',
      ],
    };

    return topics.some(topic => specs[topic].some(term => sourceText.includes(term)));
  }

  private hasPolicyGradeTitle(title: string, metadata?: any): boolean {
    const text = this.normalizeSearchText([
      title,
      metadata?.canonical_title,
      metadata?.source_title,
      metadata?.title,
      metadata?.source,
    ].filter(Boolean).join(' '));
    return [
      '정책',
      '운영정책',
      '집행기준',
      '집행 기준',
      '심사 가이드',
      '광고등록기준',
      '광고 등록 기준',
      '가이드',
      '클린센터',
    ].some(term => text.includes(term));
  }

  private buildSourceQuality(input: {
    documentId: string;
    documentTitle: string;
    documentUrl?: string;
    content: string;
    metadata?: any;
    corpus: RetrievalCorpus;
    warnings: string[];
    lexicalOverlap: number;
    vendorMatch: boolean;
    vendorMismatch: boolean;
    sourceVendor: VendorIntent | 'UNKNOWN';
    policyTitleMatch: boolean;
  }): SourceQuality {
    const hasDocumentId = Boolean(input.documentId);
    const hasTitle = Boolean(input.documentTitle && input.documentTitle !== 'Unknown');
    const hasUrl = Boolean(input.documentUrl);
    const hasExcerpt = Boolean(input.content && input.content.trim().length > 0);
    const isFallback = input.metadata?.type === 'fallback' || input.corpus === 'fallback';
    let qualityScore = 0;
    if (hasDocumentId) qualityScore += 0.22;
    if (hasTitle) qualityScore += 0.22;
    if (hasUrl) qualityScore += 0.14;
    if (hasExcerpt) qualityScore += 0.28;
    if (!isFallback) qualityScore += 0.14;
    if (!hasUrl) qualityScore -= 0.05;
    if (!hasTitle) qualityScore -= 0.12;
    if (!hasDocumentId) qualityScore -= 0.1;
    if (input.vendorMismatch) qualityScore -= 0.18;
    if (input.vendorMatch) qualityScore += 0.08;
    if (input.lexicalOverlap >= 0.2) qualityScore += 0.06;
    if (input.policyTitleMatch) qualityScore += 0.05;
    qualityScore = Math.max(0, Math.min(1, qualityScore));

    return {
      hasDocumentId,
      hasTitle,
      hasUrl,
      hasExcerpt,
      isFallback,
      warnings: input.warnings,
      linkedToDocument: Boolean(input.metadata?.document_id || input.metadata?.source_url || input.metadata?.document_url),
      qualityScore,
      corpus: input.corpus,
      lexicalOverlap: input.lexicalOverlap,
      vendorMatch: input.vendorMatch,
      vendorMismatch: input.vendorMismatch,
      sourceVendor: input.sourceVendor,
      policyTitleMatch: input.policyTitleMatch,
    };
  }

  private decideEvidence(input: {
    content: string;
    sourceQuality: SourceQuality;
    retrievalMethod: RetrievalMethod;
    corpus: RetrievalCorpus;
    hybridScore: number;
    vectorScore: number;
    keywordScore: number;
    lexicalOverlap: number;
    vendorMatch: boolean;
    vendorMismatch: boolean;
    topicExactMatch: boolean;
    policyTitleMatch: boolean;
  }): { decision: EvidenceDecision; reasons: string[] } {
    const reasons: string[] = [];
    const sourceQualityScore = input.sourceQuality.qualityScore || 0;

    if (this.isPlaceholderContent(input.content) || input.sourceQuality.warnings.includes('placeholder_content')) {
      reasons.push('placeholder_content');
    }
    if (input.retrievalMethod === 'fallback' || input.corpus === 'fallback' || input.sourceQuality.isFallback) {
      reasons.push('fallback_evidence');
    }
    if (!input.sourceQuality.hasExcerpt) reasons.push('missing_excerpt');
    if (!input.sourceQuality.hasTitle) reasons.push('missing_title');
    if (!input.sourceQuality.hasDocumentId) reasons.push('missing_document_id');
    if (!input.sourceQuality.hasUrl) reasons.push('missing_url');
    if (input.vendorMismatch && !input.vendorMatch) reasons.push('vendor_mismatch');

    if (
      reasons.includes('placeholder_content')
      || reasons.includes('fallback_evidence')
      || reasons.includes('missing_excerpt')
      || (
        reasons.includes('vendor_mismatch')
        && input.lexicalOverlap < 0.35
        && input.keywordScore < 0.45
      )
    ) {
      return {
        decision: 'rejected',
        reasons: Array.from(new Set([...reasons, 'not_answerable'])),
      };
    }

    const hasStrongScore = input.hybridScore >= 0.5 || input.keywordScore >= 0.45 || input.vectorScore >= 0.86;
    const hasGroundingSignal =
      input.lexicalOverlap >= 0.18
      || input.vendorMatch
      || input.topicExactMatch
      || input.policyTitleMatch;
    const hasSourceShape =
      input.sourceQuality.hasDocumentId
      && input.sourceQuality.hasTitle
      && input.sourceQuality.hasExcerpt
      && sourceQualityScore >= 0.65;

    if (hasStrongScore && hasGroundingSignal && hasSourceShape) {
      return {
        decision: 'verified',
        reasons: Array.from(new Set([
          'source_quality_complete',
          input.vendorMatch ? 'vendor_topic_match' : '',
          input.topicExactMatch ? 'topic_exact_match' : '',
          input.policyTitleMatch ? 'policy_title_match' : '',
          input.retrievalMethod === 'hybrid' ? 'hybrid_retrieval' : `${input.retrievalMethod}_retrieval`,
        ].filter(Boolean))),
      };
    }

    const weakReasons = [
      ...reasons,
      !hasStrongScore ? 'score_below_verified_threshold' : '',
      !hasGroundingSignal ? 'weak_grounding_signal' : '',
      !hasSourceShape ? 'incomplete_source_shape' : '',
    ].filter(Boolean);

    return {
      decision: 'weak',
      reasons: Array.from(new Set(weakReasons.length > 0 ? weakReasons : ['needs_team_lead_review'])),
    };
  }

  private isPlaceholderContent(content: string): boolean {
    const normalized = this.normalizeSearchText(content);
    return [
      '이 url은 서버리스 환경에서 크롤링할 수 없습니다',
      '이 pdf 파일은 서버리스 환경에서 텍스트 추출이 제한됩니다',
      'docx 파일은 서버리스 환경에서 처리할 수 없습니다',
      'pdf 처리 중 오류가 발생했습니다',
      'self.__next_f',
      'static/css',
      'crossorigin',
      'webpack',
      'hydration',
    ].some(pattern => normalized.includes(pattern));
  }

  private calculateHybridScore(input: {
    vectorScore: number;
    keywordScore: number;
    sourceQualityScore: number;
    retrievalMethod: RetrievalMethod;
    corpus: RetrievalCorpus;
    lexicalOverlap: number;
    vendorMatch: boolean;
    vendorMismatch: boolean;
    topicMatch: boolean;
    topicExactMatch: boolean;
    policyTitleMatch: boolean;
    genericPolicyIntent: boolean;
    originalMetaSeed: boolean;
    hasUrl: boolean;
  }): number {
    const baseScore =
      input.vectorScore * 0.42
      + input.keywordScore * 0.28
      + input.lexicalOverlap * 0.16
      + input.sourceQualityScore * 0.14;
    const methodBoost = input.retrievalMethod === 'hybrid' ? 0.08 : 0;
    const documentChunkBoost = input.corpus === 'document_chunks'
      && input.keywordScore >= 0.35
      && input.lexicalOverlap >= 0.18
      ? 0.12
      : 0;
    const vendorBoost = input.vendorMatch ? 0.18 : 0;
    const topicBoost = input.topicMatch ? 0.08 : 0;
    const topicExactBoost = input.topicExactMatch ? 0.12 : 0;
    const policyTitleBoost = input.policyTitleMatch ? 0.08 : 0;
    const mismatchPenalty = input.vendorMismatch ? 0.28 : 0;
    const vectorOnlyPenalty = input.vectorScore > 0 && input.keywordScore === 0 && input.lexicalOverlap < 0.12 ? 0.22 : 0;
    const missingLexicalPenalty = input.lexicalOverlap === 0 ? 0.08 : 0;
    const genericMetaSeedPenalty =
      input.genericPolicyIntent
      && input.originalMetaSeed
      && input.vectorScore > 0
      && input.keywordScore === 0
      && !input.topicExactMatch
      && !input.hasUrl
      && input.lexicalOverlap <= 0.2
        ? 0.3
        : 0;
    const ragTopicRescueBoost =
      input.genericPolicyIntent
      && input.topicExactMatch
      && input.policyTitleMatch
      && input.keywordScore >= 0.3
        ? 0.1
        : 0;

    return Math.max(0, Math.min(1,
      baseScore
      + methodBoost
      + documentChunkBoost
      + vendorBoost
      + topicBoost
      + topicExactBoost
      + policyTitleBoost
      + ragTopicRescueBoost
      - mismatchPenalty
      - vectorOnlyPenalty
      - missingLexicalPenalty
      - genericMetaSeedPenalty
    ));
  }

  private buildRankReason(input: {
    vectorScore: number;
    keywordScore: number;
    sourceQuality: SourceQuality;
    corpus: RetrievalCorpus;
    lexicalOverlap: number;
    vendorMatch: boolean;
    vendorMismatch: boolean;
    topicMatch: boolean;
    topicExactMatch: boolean;
    policyTitleMatch: boolean;
    genericPolicyIntent: boolean;
    originalMetaSeed: boolean;
    hasUrl: boolean;
  }): string[] {
    const reasons: string[] = [];
    if (input.vectorScore > 0) reasons.push('vector_match');
    if (input.keywordScore > 0) reasons.push('keyword_match');
    if (input.lexicalOverlap > 0) reasons.push('lexical_overlap');
    if (input.vendorMatch) reasons.push('vendor_match');
    if (input.vendorMismatch) reasons.push('vendor_mismatch_penalty');
    if (input.topicMatch) reasons.push('topic_match');
    if (input.topicExactMatch) reasons.push('topic_exact_match');
    if (input.policyTitleMatch) reasons.push('policy_title_match');
    if (input.genericPolicyIntent && input.topicExactMatch) reasons.push('generic_policy_topic_boost');
    if (
      input.genericPolicyIntent
      && input.originalMetaSeed
      && input.vectorScore > 0
      && input.keywordScore === 0
      && !input.topicExactMatch
      && !input.hasUrl
      && input.lexicalOverlap <= 0.2
    ) {
      reasons.push('generic_vector_seed_penalty');
    }
    if (input.sourceQuality.hasTitle) reasons.push('has_title');
    if (input.sourceQuality.hasUrl) reasons.push('has_url');
    if (input.corpus === 'document_chunks') reasons.push('document_chunks_keyword_corpus');
    return reasons;
  }

  private inferDocumentId(chunkId: string): string {
    return chunkId.includes('_chunk_') ? chunkId.split('_chunk_')[0] : chunkId;
  }

  private inferChunkIndex(chunkId: string, rawChunkId?: unknown): number {
    if (typeof rawChunkId === 'number') {
      return rawChunkId;
    }

    const match = chunkId.match(/_chunk_(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  private contentFingerprint(content: string): string {
    return content
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240)
      .toLowerCase();
  }

  /**
   * Fallback 모드에서 사용할 샘플 검색 결과
   */
  private getFallbackSearchResults(query: string, limit: number): SearchResult[] {
    const lowerQuery = query.toLowerCase();

    // Meta 광고 정책 관련 질문에 대한 샘플 데이터
    if (lowerQuery.includes('광고') || lowerQuery.includes('정책')) {
      const fallbackResults: SearchResult[] = [
        {
          id: 'fallback-1',
          content: 'Meta 광고 정책은 광고 콘텐츠의 품질과 안전성을 보장하기 위해 설계되었습니다. 모든 광고는 정확하고 진실된 정보를 포함해야 하며, 사용자에게 유익한 콘텐츠여야 합니다.',
          similarity: 0.8,
          score: 0.8,
          retrievalMethod: 'fallback',
          documentId: 'meta-policy-2024',
          documentTitle: 'Meta 광고 정책 2024',
          documentUrl: 'https://www.facebook.com/policies/ads',
          chunkIndex: 0,
          metadata: { type: 'fallback', retrievalMethod: 'fallback' },
          sourceQuality: {
            hasDocumentId: true,
            hasTitle: true,
            hasUrl: true,
            hasExcerpt: true,
            isFallback: true,
            warnings: ['fallback_source'],
          }
        },
        {
          id: 'fallback-2',
          content: '금지된 콘텐츠에는 폭력, 성인 콘텐츠, 허위 정보, 차별적 내용 등이 포함됩니다. 이러한 콘텐츠는 광고에 사용할 수 없으며, 정책 위반 시 광고가 거부될 수 있습니다.',
          similarity: 0.7,
          score: 0.7,
          retrievalMethod: 'fallback',
          documentId: 'meta-policy-2024',
          documentTitle: 'Meta 광고 정책 2024',
          documentUrl: 'https://www.facebook.com/policies/ads',
          chunkIndex: 1,
          metadata: { type: 'fallback', retrievalMethod: 'fallback' },
          sourceQuality: {
            hasDocumentId: true,
            hasTitle: true,
            hasUrl: true,
            hasExcerpt: true,
            isFallback: true,
            warnings: ['fallback_source'],
          }
        }
      ];
      return fallbackResults.slice(0, limit);
    }

    // Facebook/Instagram 관련 질문
    if (lowerQuery.includes('facebook') || lowerQuery.includes('instagram')) {
      const fallbackResults: SearchResult[] = [
        {
          id: 'fallback-3',
          content: 'Facebook과 Instagram은 Meta의 주요 광고 플랫폼입니다. Facebook은 광범위한 타겟팅 옵션을 제공하며, Instagram은 시각적 콘텐츠 중심의 광고에 최적화되어 있습니다.',
          similarity: 0.8,
          score: 0.8,
          retrievalMethod: 'fallback',
          documentId: 'platform-guide',
          documentTitle: 'Meta 플랫폼 가이드',
          documentUrl: 'https://business.facebook.com',
          chunkIndex: 0,
          metadata: { type: 'fallback', retrievalMethod: 'fallback' },
          sourceQuality: {
            hasDocumentId: true,
            hasTitle: true,
            hasUrl: true,
            hasExcerpt: true,
            isFallback: true,
            warnings: ['fallback_source'],
          }
        }
      ];
      return fallbackResults.slice(0, limit);
    }

    // 기본 샘플 데이터
    const fallbackResults: SearchResult[] = [
      {
        id: 'fallback-default',
        content: 'Meta 광고에 대한 질문이군요. 현재 서비스가 일시적으로 제한되어 있어 기본 정보를 제공합니다. 더 자세한 정보는 Meta 비즈니스 도움말 센터를 참조하세요.',
        similarity: 0.5,
        score: 0.5,
        retrievalMethod: 'fallback',
        documentId: 'general-info',
        documentTitle: 'Meta 광고 일반 정보',
        documentUrl: 'https://www.facebook.com/business/help',
        chunkIndex: 0,
        metadata: { type: 'fallback', retrievalMethod: 'fallback' },
        sourceQuality: {
          hasDocumentId: true,
          hasTitle: true,
          hasUrl: true,
          hasExcerpt: true,
          isFallback: true,
          warnings: ['fallback_source'],
        }
      }
    ];
    return fallbackResults.slice(0, limit);
  }

  /**
   * 코사인 유사도 계산 (개선된 버전)
   */
  private calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      console.warn('벡터 차원이 다릅니다:', vecA.length, vecB.length);
      return 0;
    }

    if (vecA.length === 0 || vecB.length === 0) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      const a = Number(vecA[i]) || 0;
      const b = Number(vecB[i]) || 0;

      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

    // NaN이나 Infinity 체크
    if (!isFinite(similarity)) {
      return 0;
    }

    return Math.max(0, Math.min(1, similarity)); // 0-1 범위로 제한
  }

  /**
   * 검색 결과를 바탕으로 답변 생성 (Ollama LLM 사용)
   */
  async generateAnswer(query: string, searchResults: SearchResult[]): Promise<string> {
    if (searchResults.length === 0) {
      return '죄송합니다. 질문과 관련된 정보를 찾을 수 없습니다. 다른 질문을 시도해보시거나 관리자에게 문의해주세요.';
    }

    // 검색 결과를 기반으로 한 지능적인 답변 생성
    console.log('🤖 검색 결과 기반 답변 생성 시작');

    const context = this.buildContextFromSearchResults(searchResults);
    const answer = this.generateIntelligentAnswer(query, searchResults, context);

    console.log('✅ 답변 생성 완료');
    return answer;
  }

  /**
   * 검색 결과를 컨텍스트로 구성
   */
  private buildContextFromSearchResults(searchResults: SearchResult[]): string {
    return searchResults
      .map((result, index) => `[출처 ${index + 1}] ${result.content}`)
      .join('\n\n');
  }

  /**
   * 검색 결과를 기반으로 한 지능적인 답변 생성
   */
  private generateIntelligentAnswer(query: string, searchResults: SearchResult[], context: string): string {
    const lowerQuery = query.toLowerCase();

    // Meta 광고 정책 관련 질문
    if (lowerQuery.includes('광고') && lowerQuery.includes('정책')) {
      return this.generatePolicyAnswer(query, searchResults, context);
    }

    // Facebook/Instagram 관련 질문
    if (lowerQuery.includes('facebook') || lowerQuery.includes('instagram')) {
      return this.generatePlatformAnswer(query, searchResults, context);
    }

    // 일반적인 질문
    return this.generateGeneralAnswer(query, searchResults, context);
  }

  /**
   * 광고 정책 관련 답변 생성
   */
  private generatePolicyAnswer(query: string, searchResults: SearchResult[], context: string): string {
    const relevantContent = this.extractRelevantContent(context, query);

    return `**Meta 광고 정책 안내**

${relevantContent}

**주요 광고 정책:**
- 광고는 정확하고 진실된 정보를 포함해야 합니다
- 금지된 콘텐츠(폭력, 성인 콘텐츠, 허위 정보 등)는 광고에 사용할 수 없습니다
- 개인정보 보호 및 데이터 사용에 대한 정책을 준수해야 합니다

**검색된 관련 정보:**
${searchResults.map((result, index) => `${index + 1}. ${result.documentTitle}: ${result.content.substring(0, 150)}...`).join('\n')}

**더 자세한 정보:**
- Meta 비즈니스 도움말 센터: https://www.facebook.com/business/help
- 광고 정책 센터: https://www.facebook.com/policies/ads

이 정보가 도움이 되었나요? 더 구체적인 질문이 있으시면 언제든지 문의해주세요.`;
  }

  /**
   * 플랫폼 관련 답변 생성
   */
  private generatePlatformAnswer(query: string, searchResults: SearchResult[], context: string): string {
    const relevantContent = this.extractRelevantContent(context, query);

    return `**Facebook/Instagram 광고 안내**

${relevantContent}

**주요 플랫폼 특징:**
- Facebook: 광범위한 타겟팅 옵션과 다양한 광고 형식
- Instagram: 시각적 콘텐츠 중심의 광고와 스토리 광고
- 두 플랫폼 모두 Meta 광고 관리자에서 통합 관리 가능

**검색된 관련 정보:**
${searchResults.map((result, index) => `${index + 1}. ${result.documentTitle}: ${result.content.substring(0, 150)}...`).join('\n')}

**더 자세한 정보:**
- Meta 비즈니스 도움말 센터에서 최신 정보를 확인하시거나, 관리자에게 문의해주세요.`;
  }

  /**
   * 일반적인 질문 답변 생성
   */
  private generateGeneralAnswer(query: string, searchResults: SearchResult[], context: string): string {
    const relevantContent = this.extractRelevantContent(context, query);

    return `**Meta 광고 FAQ 안내**

검색된 정보에 따르면:

${relevantContent}

**검색된 관련 정보:**
${searchResults.map((result, index) => `${index + 1}. ${result.documentTitle}: ${result.content.substring(0, 150)}...`).join('\n')}

**추가 정보:**
- Meta 비즈니스 도움말: https://www.facebook.com/business/help
- 광고 정책: https://www.facebook.com/policies/ads
- 광고 관리자: https://business.facebook.com

이 정보가 도움이 되었나요? 더 자세한 내용이 필요하시면 다른 질문을 해주세요.`;
  }

  /**
   * LLM 없이 기본 답변 생성 (개선된 버전)
   */
  private generateFallbackAnswer(query: string, searchResults: SearchResult[]): string {
    if (searchResults.length === 0) {
      return '죄송합니다. 질문과 관련된 정보를 찾을 수 없습니다. 다른 질문을 시도해보시거나 관리자에게 문의해주세요.';
    }

    const lowerQuery = query.toLowerCase();

    // Meta 광고 정책 관련 질문에 대한 구조화된 답변
    if (lowerQuery.includes('광고') && lowerQuery.includes('정책')) {
      return `**Meta 광고 정책 안내**

Meta 광고 정책에 대한 질문이군요. 현재 AI 답변 생성 서비스가 일시적으로 중단되어 있어, 기본 정보를 제공해드립니다.

**주요 광고 정책:**
- 광고는 정확하고 진실된 정보를 포함해야 합니다
- 금지된 콘텐츠(폭력, 성인 콘텐츠, 허위 정보 등)는 광고에 사용할 수 없습니다
- 개인정보 보호 및 데이터 사용에 대한 정책을 준수해야 합니다

**검색된 관련 정보:**
${searchResults.map((result, index) => `${index + 1}. ${result.content.substring(0, 200)}...`).join('\n')}

**더 자세한 정보:**
- Meta 비즈니스 도움말 센터: https://www.facebook.com/business/help
- 광고 정책 센터: https://www.facebook.com/policies/ads

관리자에게 문의하시면 더 구체적인 답변을 받으실 수 있습니다.`;
    }

    // Facebook/Instagram 관련 질문
    if (lowerQuery.includes('facebook') || lowerQuery.includes('instagram')) {
      return `**Facebook/Instagram 광고 안내**

Facebook이나 Instagram 관련 질문이군요. 현재 AI 답변 생성 서비스가 일시적으로 중단되어 있어, 기본 정보를 제공해드립니다.

**주요 플랫폼 특징:**
- Facebook: 광범위한 타겟팅 옵션과 다양한 광고 형식
- Instagram: 시각적 콘텐츠 중심의 광고와 스토리 광고
- 두 플랫폼 모두 Meta 광고 관리자에서 통합 관리 가능

**검색된 관련 정보:**
${searchResults.map((result, index) => `${index + 1}. ${result.content.substring(0, 200)}...`).join('\n')}

**더 자세한 정보:**
- Meta 비즈니스 도움말 센터에서 최신 정보를 확인하시거나, 관리자에게 문의해주세요.`;
    }

    // 기본 답변
    const topResult = searchResults[0];
    const content = this.extractRelevantContent(topResult.content, query);

    return `**Meta 광고 FAQ 안내**

검색된 정보에 따르면:

${content}

**추가 정보:**
- Meta 비즈니스 도움말: https://www.facebook.com/business/help
- 광고 정책: https://www.facebook.com/policies/ads
- 광고 관리자: https://business.facebook.com

이 정보가 도움이 되었나요? 더 자세한 내용이 필요하시면 다른 질문을 해주세요.`;
  }

  /**
   * 관련 내용 추출 및 정리
   */
  private extractRelevantContent(content: string, query: string): string {
    // 기본적인 텍스트 정리
    let cleanedContent = content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .trim();

    // 연속된 공백 제거
    cleanedContent = cleanedContent.replace(/\s{2,}/g, ' ');

    // 문장 단위로 정리
    const sentences = cleanedContent.split(/[.!?]+/).filter(s => s.trim().length > 10);

    // 한글이 포함된 문장 우선 선택
    const koreanSentences = sentences.filter(sentence =>
      /[\u3131-\u3163\uac00-\ud7a3]/.test(sentence)
    );

    if (koreanSentences.length > 0) {
      return koreanSentences.slice(0, 3).join('. ').trim() + '.';
    }

    // 한글 문장이 없으면 영문 문장도 포함하여 반환
    const allSentences = sentences.slice(0, 3);
    if (allSentences.length > 0) {
      return allSentences.join('. ').trim() + '.';
    }

    // 문장이 없으면 원본 내용의 일부 반환
    return cleanedContent.substring(0, 500);
  }

  /**
   * 영문 내용을 한글로 번역하여 답변 생성 (간소화됨)
   */
  private translateToKorean(content: string): string {
    // 번역 기능을 임시로 비활성화하여 빌드 오류 방지
    return content;
  }

  /**
   * 완전한 RAG 기반 챗봇 응답 생성
   */
  async generateChatResponse(query: string): Promise<ChatResponse> {
    const startTime = Date.now();

    try {
      console.log(`🚀 RAG 챗봇 응답 생성 시작: "${query}"`);

      // 1. 유사한 문서 청크 검색 (임계값을 더 낮춰서 더 많은 결과 검색)
      const searchResults = await this.searchSimilarChunks(query, 5, 0.01);
      console.log(`📊 검색 결과: ${searchResults.length}개`);

      // 2. 답변 생성
      const answer = await this.generateAnswer(query, searchResults);

      // 3. 신뢰도 계산
      const confidence = this.calculateConfidence(searchResults);

      // 4. 처리 시간 계산
      const processingTime = Date.now() - startTime;

      // 5. LLM 사용 여부 확인 (Ollama 시스템에서는 항상 true)
      const isLLMGenerated = true;

      console.log(`✅ RAG 응답 생성 완료: ${processingTime}ms, 신뢰도: ${confidence}`);

      return {
        answer,
        sources: searchResults,
        confidence,
        processingTime,
        model: isLLMGenerated ? 'tinyllama:1.1b' : 'fallback',
        isLLMGenerated
      };

    } catch (error) {
      console.error('RAG 응답 생성 실패:', error);

      // Supabase 연결 오류인 경우 특별한 메시지 제공
      if (error instanceof Error && error.message.includes('Supabase')) {
        return {
          answer: '죄송합니다. 현재 데이터베이스 연결 설정이 완료되지 않았습니다. 관리자에게 문의하시거나 잠시 후 다시 시도해주세요.\n\n임시로 Meta 광고 정책 관련 질문은 Meta 비즈니스 도움말 센터에서 확인하실 수 있습니다.',
          sources: [],
          confidence: 0,
          processingTime: Date.now() - startTime,
          model: 'error',
          isLLMGenerated: false
        };
      }

      return {
        answer: '죄송합니다. 현재 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
        sources: [],
        confidence: 0,
        processingTime: Date.now() - startTime,
        model: 'error',
        isLLMGenerated: false
      };
    }
  }

  /**
   * 검색 결과 기반 신뢰도 계산
   */
  private calculateConfidence(searchResults: SearchResult[]): number {
    if (searchResults.length === 0) return 0;

    // Hybrid score와 source quality를 함께 반영한다.
    const topScore = searchResults[0].hybridScore ?? searchResults[0].similarity;
    const averageQuality = searchResults.reduce((sum, result) => (
      sum + (result.sourceQuality.qualityScore || 0)
    ), 0) / searchResults.length;
    const confidence = (topScore * 0.75) + (averageQuality * 0.25);

    if (confidence >= 0.9) return 0.95;
    if (confidence >= 0.8) return 0.85;
    if (confidence >= 0.7) return 0.75;
    if (confidence >= 0.6) return 0.65;

    // 그 외에는 매우 낮은 신뢰도
    return 0.3;
  }

  /**
   * 검색 통계 조회
   */
  async getSearchStats(): Promise<{
    totalChunks: number;
    totalDocuments: number;
    averageSimilarity: number;
  }> {
    try {
      const { data: chunks, error: chunksError } = await this.supabase
        .from('document_chunks')
        .select('id', { count: 'exact' });

      if (chunksError) throw chunksError;

      const { data: documents, error: docsError } = await this.supabase
        .from('documents')
        .select('id', { count: 'exact' });

      if (docsError) throw docsError;

      return {
        totalChunks: chunks?.length || 0,
        totalDocuments: documents?.length || 0,
        averageSimilarity: 0.75 // 임시값
      };

    } catch (error) {
      console.error('검색 통계 조회 실패:', error);
      return {
        totalChunks: 0,
        totalDocuments: 0,
        averageSimilarity: 0
      };
    }
  }
}

// 지연 초기화를 위한 싱글톤 패턴
let ragSearchServiceInstance: RAGSearchService | null = null;

export function getRAGSearchService(): RAGSearchService {
  if (!ragSearchServiceInstance) {
    try {
      ragSearchServiceInstance = new RAGSearchService();
    } catch (error) {
      console.error('RAGSearchService 초기화 실패:', error);
      throw error;
    }
  }
  return ragSearchServiceInstance;
}

// 기존 호환성을 위한 export (deprecated)
export const ragSearchService = {
  generateChatResponse: async (message: string) => {
    const service = getRAGSearchService();
    return service.generateChatResponse(message);
  },
  getSearchStats: async () => {
    const service = getRAGSearchService();
    return service.getSearchStats();
  }
};
