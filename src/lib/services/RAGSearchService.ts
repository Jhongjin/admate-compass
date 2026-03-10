/**
 * RAG (Retrieval-Augmented Generation) 기반 검색 서비스
 * 인덱싱된 문서에서 유사한 콘텐츠를 검색하여 챗봇 답변에 활용
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { SimpleEmbeddingService } from './SimpleEmbeddingService';
import { OpenAIEmbeddingService, openAIEmbeddingService } from './OpenAIEmbeddingService';
import { GeminiService } from './GeminiService';
import { filterTruncatedSearchResults } from './search/TruncatedTextFilter';
import { rerankSearchResults } from './search/SearchResultReranker';
import { optimizeContextWindow, removeDuplicateResults } from './search/ContextWindowOptimizer';

export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  documentId: string;
  documentTitle: string;
  documentUrl?: string;
  chunkIndex: number;
  metadata?: any;
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
  private embeddingService: SimpleEmbeddingService | null = null;
  private openAIEmbeddingService: OpenAIEmbeddingService | null = null;
  private useOpenAIEmbedding: boolean = false;
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;
  private activeModel: string = 'fallback';

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log('🔧 RAGSearchService 초기화 시작...');
    console.log('📊 환경 변수 상태:', {
      hasSupabaseUrl: !!supabaseUrl,
      hasSupabaseKey: !!supabaseKey,
      supabaseUrl: supabaseUrl ? supabaseUrl.substring(0, 30) + (supabaseUrl.length > 30 ? '...' : '') : 'undefined'
    });

    if (!supabaseUrl || !supabaseKey) {
      console.warn('⚠️ Supabase 환경변수가 설정되지 않았습니다. Fallback 모드로 전환합니다.');
      console.warn('필요한 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');

      // AI 클라이언트 초기화 (Fallback 모드에서도 가능하면 초기화)
      this.initAIProviders();

      // 프로덕션 환경에서는 더미 클라이언트 사용
      if (process.env.NODE_ENV === 'production') {
        this.supabase = createClient('https://dummy.supabase.co', 'dummy-key');
        this.embeddingService = new SimpleEmbeddingService();
        console.log('✅ RAGSearchService 초기화 완료 (Fallback 모드)');
        return;
      }

      throw new Error('Supabase 환경변수가 설정되지 않았습니다. .env.local 파일을 확인해주세요.');
    }

    try {
      this.supabase = createClient(supabaseUrl, supabaseKey);
      this.initAIProviders();

      // OpenAI 임베딩 서비스 사용 가능 여부 확인
      if (openAIEmbeddingService.initialized) {
        this.openAIEmbeddingService = openAIEmbeddingService;
        this.useOpenAIEmbedding = true;
        console.log('✅ RAGSearchService 초기화 완료 (OpenAI Embedding Service)');
      } else {
        // Fallback: SimpleEmbeddingService 사용
        this.embeddingService = new SimpleEmbeddingService();
        console.log('⚠️ RAGSearchService 초기화 완료 (SimpleEmbeddingService - Fallback)');
        console.warn('⚠️ OpenAI Embedding Service를 사용할 수 없습니다. 벡터 검색 품질이 저하될 수 있습니다.');
      }
    } catch (error) {
      console.error('❌ RAGSearchService 초기화 실패:', error);
      throw new Error(`RAGSearchService 초기화 실패: ${error}`);
    }
  }

  /**
   * 질문에 대한 유사한 문서 청크 검색 (벡터 검색 구현)
   */
  async searchSimilarChunks(
    query: string,
    limit: number = 5,
    similarityThreshold: number = 0.1  // 임계값을 낮춰서 더 많은 결과 검색
  ): Promise<SearchResult[]> {
    try {
      console.log(`🔍 RAG 벡터 검색 시작: "${query}"`);

      // Fallback 모드인 경우 샘플 데이터 반환
      if (!this.supabase) {
        console.log('⚠️ Fallback 모드: 샘플 데이터 반환');
        return this.getFallbackSearchResults(query, limit);
      }

      // 질문을 임베딩으로 변환 (OpenAI 우선, 없으면 SimpleEmbeddingService)
      let queryEmbedding: number[];
      try {
        if (this.useOpenAIEmbedding && this.openAIEmbeddingService) {
          console.log('🔄 OpenAI로 쿼리 임베딩 생성 중...');
          const queryEmbeddingResult = await this.openAIEmbeddingService.generateEmbedding(query);
          queryEmbedding = queryEmbeddingResult.embedding;
          console.log(`✅ OpenAI 쿼리 임베딩 생성 완료: ${queryEmbedding.length}차원`);
        } else if (this.embeddingService) {
          console.log('🔄 SimpleEmbeddingService로 쿼리 임베딩 생성 중...');
          const queryEmbeddingResult = await this.embeddingService.generateEmbedding(query);
          queryEmbedding = queryEmbeddingResult.embedding;
          console.log(`✅ SimpleEmbeddingService 쿼리 임베딩 생성 완료: ${queryEmbedding.length}차원`);
          console.warn('⚠️ SimpleEmbeddingService는 해시 기반이므로 벡터 검색 품질이 저하될 수 있습니다.');
        } else {
          throw new Error('임베딩 서비스가 초기화되지 않았습니다.');
        }
      } catch (error) {
        console.error('❌ 임베딩 생성 실패:', error);
        return this.getFallbackSearchResults(query, limit);
      }

      // 단계적 Fallback 검색 전략 (RAGProcessor 로직 참고)
      // 1단계: 기본 임계값(0.7)으로 검색
      let searchResults = await this.performVectorSearch(
        queryEmbedding,
        limit,
        similarityThreshold,
        0.7
      );

      // 2단계: 결과가 없거나 유사도가 낮으면 임계값을 낮춰서 재검색 (0.4)
      if (searchResults.length === 0 || searchResults.every(r => r.similarity < 0.5)) {
        console.log('⚠️ 1단계 검색 결과 부족 - 임계값을 0.4로 낮춰서 재검색');
        const lowerThresholdResults = await this.performVectorSearch(
          queryEmbedding,
          limit,
          similarityThreshold,
          0.4
        );

        if (lowerThresholdResults.length > 0 &&
          lowerThresholdResults.some(r => r.similarity > 0.3)) {
          console.log(`✅ 2단계 검색 성공: ${lowerThresholdResults.length}개 결과 발견`);
          searchResults = lowerThresholdResults;
        }
      }

      // 3단계: 여전히 결과가 없으면 임계값을 더 낮춰서 재검색 (0.2)
      if (searchResults.length === 0 || searchResults.every(r => r.similarity < 0.3)) {
        console.log('⚠️ 2단계 검색 결과 부족 - 임계값을 0.2로 낮춰서 재검색');
        const veryLowThresholdResults = await this.performVectorSearch(
          queryEmbedding,
          limit * 2,
          similarityThreshold,
          0.2
        );

        if (veryLowThresholdResults.length > 0) {
          console.log(`✅ 3단계 검색 성공: ${veryLowThresholdResults.length}개 결과 발견`);
          searchResults = veryLowThresholdResults;
        }
      }

      // null 필터링
      const validSimilarityResults = searchResults.filter(
        (result): result is SearchResult => result !== null
      );

      // 질문 키워드 추출 (잘린 텍스트 필터링 및 재랭킹에 사용)
      const queryKeywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 1)
        .filter(word => !['에', '를', '을', '의', '와', '과', '은', '는', '이', '가', '에 대해', '알려주세요'].includes(word));

      // 잘린 텍스트 필터링 (질문 키워드 추출하여 관련성 높은 결과는 보존)
      const { valid: filteredResults, filtered: truncatedFiltered } = filterTruncatedSearchResults(
        validSimilarityResults,
        {
          filterHighSeverityOnly: true, // high severity만 필터링
          keepIfHasKeywords: queryKeywords, // 질문 키워드가 있으면 보존
        }
      );

      if (truncatedFiltered.length > 0) {
        console.log(`⚠️ 잘린 텍스트 패턴 감지로 ${truncatedFiltered.length}개 결과 필터링됨`);
        truncatedFiltered.forEach(({ result, reason }) => {
          console.log(`  - 필터링: ${result.documentTitle} (이유: ${reason})`);
        });
      }

      // 검색 결과 재랭킹 (관련성 점수 기반)

      // 검색 결과 재랭킹 (관련성 점수 기반)
      const rerankedResults = rerankSearchResults(filteredResults, {
        query,
        queryKeywords,
        boostSectionTitle: true,
        boostExactMatch: true,
      });

      // 중복 결과 제거
      const deduplicatedResults = removeDuplicateResults(rerankedResults, {
        sameDocumentOnly: false, // 같은 문서의 유사한 콘텐츠도 제거
        similarityThreshold: 0.85,
      });

      // 컨텍스트 윈도우 최적화
      const optimizedResults = optimizeContextWindow(deduplicatedResults, {
        maxTokens: 4000,
        maxResults: limit,
        minSimilarity: similarityThreshold,
        prioritizeSectionTitle: true,
      });

      const finalResults = optimizedResults;

      console.log(`✅ 검색 완료: ${finalResults.length}개 결과 (임계값: ${similarityThreshold}, 잘린 텍스트 필터링: ${truncatedFiltered.length}개)`);
      return finalResults as SearchResult[];

    } catch (error) {
      console.error('❌ RAG 검색 실패:', error);
      // 오류 발생 시에도 fallback 데이터 반환
      return this.getFallbackSearchResults(query, limit);
    }
  }

  /**
   * 벡터 검색 수행 (Supabase RPC 함수 사용)
   */
  private async performVectorSearch(
    queryEmbedding: number[],
    limit: number,
    minThreshold: number,
    matchThreshold: number
  ): Promise<SearchResult[]> {
    try {
      // Supabase RPC 함수 호출
      const { data, error } = await this.supabase.rpc('search_documents', {
        query_embedding: queryEmbedding,
        match_threshold: matchThreshold,
        match_count: limit * 2, // 더 많은 결과를 가져와서 필터링
        vendor_filter: null, // 벤더 필터는 나중에 추가 가능
      });

      if (error) {
        console.error('❌ 벡터 검색 RPC 오류:', error);
        return [];
      }

      if (!data || data.length === 0) {
        console.log(`📊 벡터 검색 결과 없음 (임계값: ${matchThreshold})`);
        return [];
      }

      console.log(`📊 벡터 검색 결과: ${data.length}개 (임계값: ${matchThreshold})`);

      // SearchResult 형식으로 변환
      const results: SearchResult[] = (data || [])
        .map((item: any) => {
          const similarity = item.similarity || 0;

          // 최소 임계값 필터링
          if (similarity < minThreshold) {
            return null;
          }

          return {
            id: item.chunk_id,
            content: item.content,
            similarity: similarity,
            documentId: item.document_id,
            documentTitle: item.title || item.metadata?.title || 'Unknown',
            documentUrl: item.metadata?.url || (item.document_type === 'url' ? item.metadata?.source : undefined),
            chunkIndex: item.metadata?.chunk_index || 0,
            metadata: {
              ...item.metadata,
              source_vendor: item.source_vendor,
              document_type: item.document_type,
            },
          };
        })
        .filter((result: SearchResult | null): result is SearchResult => result !== null)
        .sort((a: SearchResult, b: SearchResult) => b.similarity - a.similarity)
        .slice(0, limit); // 최종 limit만큼만 반환

      return results;
    } catch (error) {
      console.error('❌ 벡터 검색 수행 오류:', error);
      return [];
    }
  }

  /**
   * Fallback 모드에서 사용할 샘플 검색 결과
   */
  private getFallbackSearchResults(query: string, limit: number): SearchResult[] {
    const lowerQuery = query.toLowerCase();

    // Meta 광고 정책 관련 질문에 대한 샘플 데이터
    if (lowerQuery.includes('광고') || lowerQuery.includes('정책')) {
      return [
        {
          id: 'fallback-1',
          content: 'Meta 광고 정책은 광고 콘텐츠의 품질과 안전성을 보장하기 위해 설계되었습니다. 모든 광고는 정확하고 진실된 정보를 포함해야 하며, 사용자에게 유익한 콘텐츠여야 합니다.',
          similarity: 0.8,
          documentId: 'meta-policy-2024',
          documentTitle: 'Meta 광고 정책 2024',
          documentUrl: 'https://www.facebook.com/policies/ads',
          chunkIndex: 0,
          metadata: { type: 'policy' }
        },
        {
          id: 'fallback-2',
          content: '금지된 콘텐츠에는 폭력, 성인 콘텐츠, 허위 정보, 차별적 내용 등이 포함됩니다. 이러한 콘텐츠는 광고에 사용할 수 없으며, 정책 위반 시 광고가 거부될 수 있습니다.',
          similarity: 0.7,
          documentId: 'meta-policy-2024',
          documentTitle: 'Meta 광고 정책 2024',
          documentUrl: 'https://www.facebook.com/policies/ads',
          chunkIndex: 1,
          metadata: { type: 'policy' }
        }
      ].slice(0, limit);
    }

    // Facebook/Instagram 관련 질문
    if (lowerQuery.includes('facebook') || lowerQuery.includes('instagram')) {
      return [
        {
          id: 'fallback-3',
          content: 'Facebook과 Instagram은 Meta의 주요 광고 플랫폼입니다. Facebook은 광범위한 타겟팅 옵션을 제공하며, Instagram은 시각적 콘텐츠 중심의 광고에 최적화되어 있습니다.',
          similarity: 0.8,
          documentId: 'platform-guide',
          documentTitle: 'Meta 플랫폼 가이드',
          documentUrl: 'https://business.facebook.com',
          chunkIndex: 0,
          metadata: { type: 'guide' }
        }
      ].slice(0, limit);
    }

    // 기본 샘플 데이터
    return [
      {
        id: 'fallback-default',
        content: 'Meta 광고에 대한 질문이군요. 제공된 내부 문서를 바탕으로 답변드립니다.',
        similarity: 0.5,
        documentId: 'general-info',
        documentTitle: 'Meta 광고 일반 정보',
        documentUrl: 'https://www.facebook.com/business/help',
        chunkIndex: 0,
        metadata: { type: 'general' }
      }
    ].slice(0, limit);
  }

  /**
   * AI 프로바이더 초기화
   */
  private initAIProviders() {
    // Anthropic (Claude) 초기화
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      console.log('✅ Anthropic API 클라이언트 초기화 완료');
    }

    // OpenAI (GPT) 초기화
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      console.log('✅ OpenAI API 클라이언트 초기화 완료');
    }
  }

  /**
   * 검색 결과를 바탕으로 답변 생성 (LLM 사용)
   */
  async generateAnswer(query: string, searchResults: SearchResult[]): Promise<string> {
    // 검색 결과가 없거나 유사도가 낮으면 관련 내용 없음 응답
    const hasRelevantResults = searchResults.length > 0 &&
      searchResults.some(result => result.similarity > 0.3); // 유사도 30% 이상인 결과가 있는지 확인

    if (!hasRelevantResults) {
      this.activeModel = 'no-data';
      return '죄송합니다. 제공된 내부 문서에서 질문과 관련된 정보를 찾을 수 없습니다.\n\n📧 **더 정확한 답변을 원하시면:**\n담당팀(fb@nasmedia.co.kr)에 직접 문의해주시면 더 구체적인 답변을 받으실 수 있습니다.';
    }

    const context = this.buildContextFromSearchResults(searchResults);
    console.log(`📝 컨텍스트 길이: ${context.length}자`);

    const enhancedPrompt = `질문: ${query}

관련 문서 내용:
${context}

🚨 **중요 지침:**
- 오직 위에 제공된 문서 내용만을 바탕으로 답변하세요
- 문서에 없는 정보는 절대 생성하거나 추측하지 마세요
- 제공된 문서에 명시되지 않은 모든 회사명, 정책, 절차, 정보는 언급하지 마세요
- 일반적인 광고 지식이나 외부 정보는 절대 사용하지 마세요
- 문서에 없는 내용은 "제공된 문서에서 찾을 수 없습니다"라고 답변하고 담당팀(fb@nasmedia.co.kr) 문의를 안내하세요
- 답변 시 "제공된 문서에 따르면" 또는 "Meta 정책 문서에 의하면"이라고 출처를 명시하세요
- Meta 외의 다른 회사나 서비스에 대한 정보는 절대 제공하지 마세요`;

    // 1. Google Gemini 시도
    if (process.env.GOOGLE_API_KEY) {
      try {
        console.log('🔍 Gemini 서비스로 답변 생성 시도...');
        const geminiService = new GeminiService();
        const llmResponse = await geminiService.generateAnswer(enhancedPrompt);
        this.activeModel = llmResponse.model || process.env.GOOGLE_MODEL || 'gemini-1.5-flash';
        return llmResponse.answer;
      } catch (geminiError) {
        console.error('❌ Gemini 답변 생성 실패:', geminiError);
      }
    }

    // 2. Anthropic Claude 시도
    if (this.anthropic) {
      try {
        console.log('🔍 Anthropic Claude로 답변 생성 시도...');
        const message = await this.anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4000,
          messages: [{ role: 'user', content: enhancedPrompt }],
        });
        this.activeModel = 'claude-3-5-sonnet';
        const content = message.content[0];
        if (content && 'text' in content) {
          return content.text;
        }
      } catch (claudeError) {
        console.error('❌ Claude 답변 생성 실패:', claudeError);
      }
    }

    // 3. OpenAI GPT 시도
    if (this.openai) {
      try {
        console.log('🔍 OpenAI GPT로 답변 생성 시도...');
        const completion = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: enhancedPrompt }],
          max_tokens: 2000,
        });
        this.activeModel = 'gpt-4o-mini';
        return completion.choices[0]?.message?.content || '';
      } catch (gptError) {
        console.error('❌ GPT 답변 생성 실패:', gptError);
      }
    }

    // 모든 LLM 실패 시 Fallback
    console.log('⚠️ 모든 LLM 프로바이더 사용 불가, Fallback 답변 생성');
    this.activeModel = 'fallback';
    return this.generateFallbackAnswer(query, searchResults);
  }


  /**
   * 검색 결과를 컨텍스트로 구성
   */
  private buildContextFromSearchResults(searchResults: SearchResult[]): string {
    return searchResults
      .map((result, index) => `[출처 ${index + 1}] ${result.content} `)
      .join('\n\n');
  }

  /**
   * LLM 없이 기본 답변 생성 (개선된 버전)
   */
  private generateFallbackAnswer(query: string, searchResults: SearchResult[]): string {
    if (searchResults.length === 0) {
      return '죄송합니다. 제공된 내부 문서에서 질문과 관련된 정보를 찾을 수 없습니다.\n\n📧 **더 정확한 답변을 원하시면:**\n담당팀(fb@nasmedia.co.kr)에 직접 문의해주시면 더 구체적인 답변을 받으실 수 있습니다.';
    }

    const lowerQuery = query.toLowerCase();

    // Meta 광고 정책 관련 질문에 대한 구조화된 답변
    if (lowerQuery.includes('광고') && lowerQuery.includes('정책')) {
      return `** Meta 광고 정책 안내 **

  제공된 내부 문서를 바탕으로 답변드립니다.

** 검색된 관련 정보:**
  ${searchResults.map((result, index) => `${index + 1}. ${result.content.substring(0, 200)}...`).join('\n')}

📧 ** 더 자세한 정보가 필요하시면:**
  담당팀(fb@nasmedia.co.kr)에 문의해주시면 더 구체적인 답변을 받으실 수 있습니다.`;
    }

    // Facebook/Instagram 관련 질문
    if (lowerQuery.includes('facebook') || lowerQuery.includes('instagram')) {
      return `** Facebook / Instagram 광고 안내 **

  제공된 내부 문서를 바탕으로 답변드립니다.

** 검색된 관련 정보:**
  ${searchResults.map((result, index) => `${index + 1}. ${result.content.substring(0, 200)}...`).join('\n')}

📧 ** 더 자세한 정보가 필요하시면:**
  담당팀(fb@nasmedia.co.kr)에 문의해주시면 더 구체적인 답변을 받으실 수 있습니다.`;
    }

    // 기본 답변
    const topResult = searchResults[0];
    const content = this.extractRelevantContent(topResult.content, query);

    return `** Meta 광고 FAQ 안내 **

  검색된 정보에 따르면:

${content}

** 추가 정보:**
  - Meta 비즈니스 도움말: https://www.facebook.com/business/help
  - 광고 정책: https://www.facebook.com/policies/ads
  - 광고 관리자: https://business.facebook.com

이 정보가 도움이 되었나요 ? 더 자세한 내용이 필요하시면 다른 질문을 해주세요.`;
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
      console.log(`📊 검색 결과: ${searchResults.length} 개`);

      // 2. 답변 생성
      const answer = await this.generateAnswer(query, searchResults);

      // 3. 신뢰도 계산
      const confidence = this.calculateConfidence(searchResults);

      // 4. 처리 시간 계산
      const processingTime = Date.now() - startTime;

      // 5. LLM 사용 여부 확인
      const isLLMGenerated = this.activeModel !== 'fallback' && this.activeModel !== 'no-data' && this.activeModel !== 'error';

      console.log(`✅ RAG 응답 생성 완료: ${processingTime} ms, 신뢰도: ${confidence}, 모델: ${this.activeModel} `);

      return {
        answer,
        sources: searchResults,
        confidence,
        processingTime,
        model: this.activeModel,
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

    // 상위 결과의 유사도 기반 신뢰도 계산
    const topSimilarity = searchResults[0].similarity;

    if (topSimilarity >= 0.9) return 0.95;
    if (topSimilarity >= 0.8) return 0.85;
    if (topSimilarity >= 0.7) return 0.75;
    if (topSimilarity >= 0.6) return 0.65;

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