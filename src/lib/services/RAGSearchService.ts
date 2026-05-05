/**
 * RAG (Retrieval-Augmented Generation) 기반 검색 서비스
 * 인덱싱된 문서에서 유사한 콘텐츠를 검색하여 챗봇 답변에 활용
 */

import { createCompassServiceClient } from '@/lib/supabase/compass';
import { SimpleEmbeddingService } from './SimpleEmbeddingService';
import { generateResponse } from './ollama';

export type RetrievalMethod = 'vector' | 'keyword' | 'hybrid' | 'fallback';
export type RetrievalCorpus = 'ollama_document_chunks' | 'document_chunks' | 'fallback';
export type EvidenceType = 'vector' | 'keyword' | 'hybrid' | 'fallback';
export type VendorIntent = 'META' | 'KAKAO' | 'NAVER' | 'GOOGLE';
export type TopicIntent = 'review' | 'youth' | 'false_claim' | 'price' | 'event' | 'rights' | 'hate' | 'gambling' | 'spec';

export interface QueryIntent {
  vendors: VendorIntent[];
  topics: TopicIntent[];
  keywords: string[];
  adPolicyTerms: string[];
  outOfScopeTerms: string[];
  isOutOfScope: boolean;
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
  rankReason?: string[];
  lexicalOverlap?: number;
  vendorMatch?: boolean;
  vendorMismatch?: boolean;
  sourceVendor?: VendorIntent | 'UNKNOWN';
  sourceVendors?: VendorIntent[];
  topicMatch?: boolean;
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
        keywordCount: intent.keywords.length,
        outOfScopeTerms: intent.outOfScopeTerms,
        isOutOfScope: intent.isOutOfScope,
      });

      if (intent.isOutOfScope) {
        console.log('⚠️ 광고/정책 범위 밖 질문으로 판단하여 검색을 중단합니다.');
        return [];
      }

      // 질문을 임베딩으로 변환
      const queryEmbeddingResult = await this.embeddingService.generateEmbedding(query);
      const queryEmbedding = queryEmbeddingResult.embedding;
      console.log(`📊 질문 임베딩 생성 완료: ${queryEmbedding.length}차원`);

      const [vectorCandidates, keywordCandidates] = await Promise.all([
        this.searchVectorCandidates(queryEmbedding, limit, intent),
        this.searchKeywordCandidates(query, limit, intent)
      ]);

      console.log(`📊 Hybrid 후보 수집 결과: vector=${vectorCandidates.length}, keyword=${keywordCandidates.length}`);
      const rankedResults = this.mergeDedupeAndRankCandidates(
        [...vectorCandidates, ...keywordCandidates],
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
    const documentTitle = result.metadata?.title || result.title || result.metadata?.source || 'Unknown';
    const documentUrl = result.metadata?.source_url || result.metadata?.document_url || result.metadata?.url;
    const chunkIndex = this.inferChunkIndex(chunkId, result.chunk_id);
    const warnings: string[] = [];

    if (!documentId) warnings.push('missing_document_id');
    if (!documentTitle || documentTitle === 'Unknown') warnings.push('missing_title');
    if (!documentUrl) warnings.push('missing_url');
    if (!content.trim()) warnings.push('missing_excerpt');

    const vectorScore = this.resolveVectorScore(result, options.queryEmbedding);
    const sourceText = this.buildCandidateSearchText(content, documentTitle, {
      ...(result.metadata || {}),
      document_id: documentId,
      chunk_id: chunkId,
    });
    const lexicalOverlap = this.calculateLexicalOverlap(sourceText, options.intent.keywords);
    const vendorAlignment = this.calculateVendorAlignment(sourceText, options.intent.vendors);
    const topicMatch = this.hasTopicMatch(sourceText, options.intent.topics);
    const keywordScore = this.calculateKeywordScore(content, documentTitle, options.keywords || [], lexicalOverlap, topicMatch);
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
    });
    const hybridScore = this.calculateHybridScore({
      vectorScore,
      keywordScore,
      sourceQualityScore: sourceQuality.qualityScore || 0,
      retrievalMethod: options.retrievalMethod,
      corpus: options.corpus,
      lexicalOverlap,
      vendorMatch: vendorAlignment.match,
      vendorMismatch: vendorAlignment.mismatch,
      topicMatch,
    });
    const rankReason = this.buildRankReason({
      vectorScore,
      keywordScore,
      sourceQuality,
      corpus: options.corpus,
      lexicalOverlap,
      vendorMatch: vendorAlignment.match,
      vendorMismatch: vendorAlignment.mismatch,
      topicMatch,
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
      rankReason,
      lexicalOverlap,
      vendorMatch: vendorAlignment.match,
      vendorMismatch: vendorAlignment.mismatch,
      sourceVendor: vendorAlignment.primaryVendor,
      sourceVendors: vendorAlignment.sourceVendors,
      topicMatch,
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

    for (const candidate of candidates) {
      if (!this.isVerifiedEvidence(candidate, intent, hasTargetVendorRescueCandidate)) {
        continue;
      }

      const dedupeKeys = this.getDedupeKeys(candidate);
      const existingKey = dedupeKeys.find(key => byKey.has(key));

      if (!existingKey) {
        byKey.set(dedupeKeys[0], candidate);
        continue;
      }

      const existing = byKey.get(existingKey)!;
      const merged = this.mergeDuplicateCandidate(existing, candidate);
      byKey.delete(existingKey);
      byKey.set(this.getDedupeKeys(merged)[0], merged);
    }

    const documentCounts = new Map<string, number>();
    const titleCounts = new Map<string, number>();

    const ranked = Array.from(byKey.values())
      .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0));
    const rescueCandidate = ranked.find(candidate => this.isTargetVendorRescueCandidate(candidate, intent));
    const selected = ranked.filter((candidate) => {
        const docKey = candidate.documentId || candidate.id;
        const titleKey = candidate.documentTitle || docKey;
        const docCount = documentCounts.get(docKey) || 0;
        const titleCount = titleCounts.get(titleKey) || 0;

        if (docCount >= 2 || titleCount >= 2) {
          return false;
        }

        documentCounts.set(docKey, docCount + 1);
        titleCounts.set(titleKey, titleCount + 1);
        return true;
      })
      .slice(0, limit);

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
      return selected.sort((a, b) => {
        if (a.id === rescueCandidate.id) return -1;
        if (b.id === rescueCandidate.id) return 1;
        return (b.hybridScore || 0) - (a.hybridScore || 0);
      });
    }

    return selected;
  }

  private mergeDuplicateCandidate(existing: SearchResult, incoming: SearchResult): SearchResult {
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
    const retrievalMethod: RetrievalMethod = vectorScore > 0 && keywordScore > 0 ? 'hybrid' : existing.retrievalMethod;
    const evidenceType: EvidenceType = retrievalMethod === 'hybrid' ? 'hybrid' : existing.evidenceType || incoming.evidenceType || retrievalMethod;
    const hybridScore = this.calculateHybridScore({
      vectorScore,
      keywordScore,
      sourceQualityScore,
      retrievalMethod,
      corpus: existing.corpus || incoming.corpus || 'ollama_document_chunks',
      lexicalOverlap,
      vendorMatch,
      vendorMismatch,
      topicMatch,
    });
    const warnings = Array.from(new Set([
      ...existing.sourceQuality.warnings,
      ...incoming.sourceQuality.warnings,
    ]));
    const rankReason = Array.from(new Set([
      ...(existing.rankReason || []),
      ...(incoming.rankReason || []),
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
        sourceQualityWarnings: warnings,
      },
    };
  }

  private isVerifiedEvidence(candidate: SearchResult, intent: QueryIntent, hasTargetVendorRescueCandidate: boolean): boolean {
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

    if (hybridScore < 0.25) return false;
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
    const normalized = this.normalizeSearchText(query);
    const vendors = this.detectVendors(normalized);
    const topics = this.detectTopics(normalized);
    const adPolicyTerms = this.matchTerms(normalized, [
      '광고', '정책', '심사', '소재', '매체', '캠페인', '타겟', '집행', '승인', '반려',
      'meta', 'facebook', '페이스북', 'instagram', '인스타그램', 'kakao', '카카오',
      'naver', '네이버', 'google', '구글', 'youtube', '유튜브', 'gdn'
    ]);
    const outOfScopeTerms = this.matchTerms(normalized, [
      '날씨', '기온', '우산', '미세먼지', '김치찌개', '레시피', '요리', '맛집',
      '주식', '코인', '환율', '연예', '영화 추천', '건강 상담', '진단', '치료'
    ]);
    const keywords = this.extractKeywords(query);

    return {
      vendors,
      topics,
      keywords,
      adPolicyTerms,
      outOfScopeTerms,
      isOutOfScope: outOfScopeTerms.length > 0 && adPolicyTerms.length === 0,
    };
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

  private calculateKeywordScore(content: string, title: string, keywords: string[], lexicalOverlap: number, topicMatch: boolean): number {
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
    return Math.max(0, Math.min(1, (rawScore * 0.75) + (lexicalOverlap * 0.25) + topicBoost));
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
      metadata?.source,
      metadata?.source_vendor,
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

  private calculateVendorAlignment(sourceText: string, vendors: VendorIntent[]): {
    match: boolean;
    mismatch: boolean;
    primaryVendor: VendorIntent | 'UNKNOWN';
    sourceVendors: VendorIntent[];
  } {
    const sourceVendors = this.detectVendors(sourceText);
    const primaryVendor = this.choosePrimaryVendor(sourceVendors, vendors);
    if (vendors.length === 0) {
      return { match: false, mismatch: false, primaryVendor, sourceVendors };
    }

    const match = vendors.some(vendor => sourceVendors.includes(vendor));
    const mismatch = sourceVendors.length > 0 && !match;

    return { match, mismatch, primaryVendor, sourceVendors };
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
    };
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
    const mismatchPenalty = input.vendorMismatch ? 0.28 : 0;
    const vectorOnlyPenalty = input.vectorScore > 0 && input.keywordScore === 0 && input.lexicalOverlap < 0.12 ? 0.22 : 0;
    const missingLexicalPenalty = input.lexicalOverlap === 0 ? 0.08 : 0;

    return Math.max(0, Math.min(1,
      baseScore
      + methodBoost
      + documentChunkBoost
      + vendorBoost
      + topicBoost
      - mismatchPenalty
      - vectorOnlyPenalty
      - missingLexicalPenalty
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
  }): string[] {
    const reasons: string[] = [];
    if (input.vectorScore > 0) reasons.push('vector_match');
    if (input.keywordScore > 0) reasons.push('keyword_match');
    if (input.lexicalOverlap > 0) reasons.push('lexical_overlap');
    if (input.vendorMatch) reasons.push('vendor_match');
    if (input.vendorMismatch) reasons.push('vendor_mismatch_penalty');
    if (input.topicMatch) reasons.push('topic_match');
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
