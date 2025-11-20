/**
 * OpenAI Embeddings API 서비스
 * 정확도가 중요한 서비스를 위한 안정적인 임베딩 생성
 */

import OpenAI from 'openai';

export interface OpenAIEmbeddingResult {
  embedding: number[];
  model: string;
  dimension: number;
  processingTime: number;
}

export interface OpenAIEmbeddingOptions {
  model?: 'text-embedding-3-small' | 'text-embedding-3-large' | 'text-embedding-ada-002';
  batchSize?: number;
}

export class OpenAIEmbeddingService {
  private client: OpenAI | null = null;
  private apiKey: string | null = null;
  private defaultModel: string = 'text-embedding-3-small';
  // DB chunks 테이블의 embedding 컬럼이 1024 차원으로 정의되어 있으므로 1024 사용
  // OpenAI text-embedding-3-small은 256~1536 차원 범위에서 조정 가능
  private defaultDimension: number = 1024;

  constructor() {
    this.apiKey =
      process.env.OPENAI_EMBEDDING_API_KEY ||
      process.env.OPENAI_API_KEY ||
      null;
    if (this.apiKey) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
      });
      console.log('✅ OpenAI Embedding Service 초기화 완료');
    } else {
      console.warn('⚠️ OPENAI_API_KEY가 설정되지 않았습니다. OpenAI Embeddings API를 사용할 수 없습니다.');
    }
  }

  /**
   * 초기화 상태 확인
   */
  get initialized(): boolean {
    return this.client !== null && this.apiKey !== null;
  }

  /**
   * 단일 텍스트에 대한 임베딩 생성
   */
  async generateEmbedding(
    text: string,
    options: OpenAIEmbeddingOptions = {}
  ): Promise<OpenAIEmbeddingResult> {
    const startTime = Date.now();

    if (!this.client || !this.apiKey) {
      throw new Error('OpenAI API 키가 설정되지 않았습니다. OPENAI_API_KEY 환경 변수를 설정해주세요.');
    }

    if (!text || text.trim().length === 0) {
      throw new Error('빈 텍스트는 임베딩을 생성할 수 없습니다.');
    }

    const model = options.model || this.defaultModel;
    const maxTokens = this.getMaxTokensForModel(model);

    // 텍스트 전처리 및 길이 제한
    const processedText = this.preprocessText(text, maxTokens);

    try {
      console.log(`🔄 OpenAI 임베딩 생성 중: "${processedText.substring(0, 50)}..." (모델: ${model})`);

      const response = await this.client.embeddings.create({
        model: model,
        input: processedText,
        dimensions: this.defaultDimension, // text-embedding-3-small의 기본 차원
      });

      if (!response.data || response.data.length === 0) {
        throw new Error('OpenAI API에서 임베딩을 받지 못했습니다.');
      }

      const embedding = response.data[0].embedding;
      const dimension = embedding.length;
      const processingTime = Date.now() - startTime;

      // 임베딩 유효성 검증
      if (!embedding || embedding.length === 0) {
        throw new Error('생성된 임베딩이 비어있습니다.');
      }

      if (!embedding.every(item => typeof item === 'number' && !isNaN(item))) {
        throw new Error('임베딩에 유효하지 않은 숫자가 포함되어 있습니다.');
      }

      console.log(`✅ OpenAI 임베딩 생성 성공: ${dimension}차원, ${processingTime}ms (모델: ${model})`);

      return {
        embedding,
        model,
        dimension,
        processingTime,
      };
    } catch (error) {
      console.error('❌ OpenAI 임베딩 생성 실패:', error);
      if (error instanceof OpenAI.APIError) {
        console.error('❌ OpenAI API 응답 상세:', {
          status: error.status,
          code: error.code,
          type: error.type,
          param: error.param,
          headers: error.headers,
        });
      } else if ((error as any)?.response) {
        const err = error as any;
        console.error('❌ OpenAI API HTTP 응답:', {
          status: err.response?.status,
          statusText: err.response?.statusText,
          data: err.response?.data,
        });
      }
      throw new Error(`OpenAI 임베딩 생성 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 여러 텍스트에 대한 배치 임베딩 생성
   */
  async generateBatchEmbeddings(
    texts: string[],
    options: OpenAIEmbeddingOptions = {}
  ): Promise<OpenAIEmbeddingResult[]> {
    const startTime = Date.now();

    if (!this.client || !this.apiKey) {
      throw new Error('OpenAI API 키가 설정되지 않았습니다.');
    }

    if (texts.length === 0) {
      return [];
    }

    const model = options.model || this.defaultModel;
    const batchSize = options.batchSize || 100; // OpenAI API는 최대 2048개까지 배치 처리 가능
    const maxTokens = this.getMaxTokensForModel(model);
    const results: OpenAIEmbeddingResult[] = [];

    // 텍스트 전처리
    const processedTexts = texts.map(text => this.preprocessText(text, maxTokens));

    try {
      // 배치 처리
      for (let i = 0; i < processedTexts.length; i += batchSize) {
        const batch = processedTexts.slice(i, i + batchSize);
        console.log(`🔄 OpenAI 배치 임베딩 생성 중: ${i + 1}-${Math.min(i + batchSize, processedTexts.length)}/${processedTexts.length} (모델: ${model})`);

        const response = await this.client.embeddings.create({
          model: model,
          input: batch,
          dimensions: this.defaultDimension,
        });

        if (!response.data || response.data.length !== batch.length) {
          throw new Error(`OpenAI API에서 예상한 개수의 임베딩을 받지 못했습니다. (예상: ${batch.length}, 실제: ${response.data?.length || 0})`);
        }

        const batchResults: OpenAIEmbeddingResult[] = response.data.map((item, index) => ({
          embedding: item.embedding,
          model,
          dimension: item.embedding.length,
          processingTime: Date.now() - startTime,
        }));

        results.push(...batchResults);
      }

      console.log(`✅ OpenAI 배치 임베딩 생성 완료: ${texts.length}개 텍스트, ${Date.now() - startTime}ms (모델: ${model})`);
      return results;
    } catch (error) {
      console.error('❌ OpenAI 배치 임베딩 생성 실패:', error);
      if (error instanceof OpenAI.APIError) {
        console.error('❌ OpenAI API 응답 상세:', {
          status: error.status,
          code: error.code,
          type: error.type,
          param: error.param,
          headers: error.headers,
        });
      } else if ((error as any)?.response) {
        const err = error as any;
        console.error('❌ OpenAI API HTTP 응답:', {
          status: err.response?.status,
          statusText: err.response?.statusText,
          data: err.response?.data,
        });
      }
      throw new Error(`OpenAI 배치 임베딩 생성 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 텍스트 전처리 (한국어 최적화)
   */
  private preprocessText(text: string, maxTokens: number): string {
    return text
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s가-힣.,!?;:()\[\]{}"'`~@#$%^&*+=|\\/<>]/g, '')
      .replace(/[.]{2,}/g, '.')
      .replace(/[!]{2,}/g, '!')
      .replace(/[?]{2,}/g, '?')
      // 토큰 수 추정 (한국어는 대략 1자 = 0.5 토큰)
      .slice(0, maxTokens * 2); // 안전 마진을 위해 2배로 제한
  }

  /**
   * 모델별 최대 토큰 수
   */
  private getMaxTokensForModel(model: string): number {
    switch (model) {
      case 'text-embedding-3-small':
      case 'text-embedding-3-large':
        return 8191; // 최대 8191 토큰
      case 'text-embedding-ada-002':
        return 8191;
      default:
        return 8191;
    }
  }

  /**
   * 임베딩 차원 확인
   */
  getEmbeddingDimension(): number {
    return this.defaultDimension;
  }

  /**
   * 모델 정보 반환
   */
  getModelInfo(): { name: string; dimension: number; maxTokens: number } {
    return {
      name: this.defaultModel,
      dimension: this.defaultDimension,
      maxTokens: 8191,
    };
  }
}

// 싱글톤 인스턴스
export const openAIEmbeddingService = new OpenAIEmbeddingService();

