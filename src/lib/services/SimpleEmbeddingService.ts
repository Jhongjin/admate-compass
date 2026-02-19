/**
 * 간단한 임베딩 서비스 (Fallback)
 * @xenova/transformers가 실패할 경우 사용
 */

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimension: number;
  processingTime: number;
}

export interface EmbeddingOptions {
  model?: 'simple' | 'bge-m3' | 'all-MiniLM-L6-v2' | 'openai';
  batchSize?: number;
  normalize?: boolean;
}

export class SimpleEmbeddingService {
  private model: string;

  constructor() {
    this.model = 'simple-hash';
    console.log('🔧 SimpleEmbeddingService 초기화 완료');
  }

  /**
   * 간단한 해시 기반 임베딩 생성
   */
  async generateEmbedding(
    text: string,
    options: EmbeddingOptions = {}
  ): Promise<EmbeddingResult> {
    const startTime = Date.now();
    
    try {
      // 텍스트 전처리
      const processedText = this.preprocessText(text);
      
      if (!processedText || processedText.trim().length === 0) {
        throw new Error('빈 텍스트는 임베딩을 생성할 수 없습니다.');
      }

      console.log(`🔄 간단한 임베딩 생성 중: "${processedText.substring(0, 50)}..."`);
      
      // 해시 기반 임베딩 생성
      const embedding = this.generateHashEmbedding(processedText);
      
      const dimension = embedding.length;
      const processingTime = Date.now() - startTime;

      console.log(`✅ 간단한 임베딩 생성 성공: ${dimension}차원, ${processingTime}ms`);

      return {
        embedding,
        model: this.model,
        dimension,
        processingTime
      };
    } catch (error) {
      console.error('❌ 간단한 임베딩 생성 실패:', error);
      throw error;
    }
  }

  /**
   * 텍스트 전처리
   */
  private preprocessText(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s가-힣]/g, ' ') // 특수문자 제거, 한글 유지
      .replace(/\s+/g, ' ') // 여러 공백을 하나로
      .trim();
  }

  /**
   * 해시 기반 임베딩 생성
   */
  private generateHashEmbedding(text: string): number[] {
    const embedding = new Array(768).fill(0);
    
    // 텍스트를 768개 청크로 나누어 해시 생성
    const chunkSize = Math.max(1, Math.floor(text.length / 768));
    
    for (let i = 0; i < 768; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, text.length);
      const chunk = text.substring(start, end);
      
      // 간단한 해시 함수
      let hash = 0;
      for (let j = 0; j < chunk.length; j++) {
        const char = chunk.charCodeAt(j);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 32bit 정수로 변환
      }
      
      // -1 ~ 1 범위로 정규화
      embedding[i] = (hash % 2000) / 1000 - 1;
    }
    
    return embedding;
  }

  /**
   * 여러 텍스트에 대한 배치 임베딩 생성
   */
  async generateBatchEmbeddings(
    texts: string[],
    options: EmbeddingOptions = {}
  ): Promise<EmbeddingResult[]> {
    const startTime = Date.now();
    const batchSize = options.batchSize || 10;
    const results: EmbeddingResult[] = [];

    console.log(`🔄 배치 임베딩 생성 중: ${texts.length}개 텍스트`);

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      
      for (const text of batch) {
        try {
          const result = await this.generateEmbedding(text, options);
          results.push(result);
        } catch (error) {
          console.error(`배치 임베딩 실패 (${text.substring(0, 30)}...):`, error);
          // 실패한 경우 0으로 채워진 임베딩 생성
          results.push({
            embedding: new Array(768).fill(0),
            model: this.model,
            dimension: 768,
            processingTime: 0
          });
        }
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`✅ 배치 임베딩 완료: ${results.length}개, ${totalTime}ms`);

    return results;
  }
}
