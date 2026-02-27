import { embeddingService } from './EmbeddingService';

/**
 * 의미 기반 청킹 서비스
 * 문장 임베딩을 이용한 의미적 경계 탐지 및 청킹
 * 서버 사이드에서만 사용 (API 라우트)
 */

/**
 * 임베딩 생성 유틸리티 (로컬/원격 서비스 사용)
 */
async function generateRealEmbedding(text: string): Promise<number[]> {
  try {
    const result = await embeddingService.generateEmbedding(text);
    return result.embedding;
  } catch (error) {
    console.warn('⚠️ 실제 임베딩 생성 실패, 기본값 반환:', error);
    const embeddingDim = embeddingService.getEmbeddingDimension();
    return new Array(embeddingDim).fill(0);
  }
}
try {
  // 환경변수에서 임베딩 차원 수 가져오기
  const embeddingDim = parseInt(process.env.EMBEDDING_DIM || '1024');

  // 간단한 해시 기반 임베딩 생성 (실제 임베딩은 아니지만 테스트용)
  const hash = simpleHash(text);
  const embedding = new Array(embeddingDim).fill(0);

  // 해시값을 기반으로 임베딩 벡터 생성
  for (let i = 0; i < embeddingDim; i++) {
    embedding[i] = Math.sin(hash + i) * 0.1;
  }

  return embedding;
} catch (error) {
  console.warn('⚠️ 임베딩 생성 실패, 기본값 반환:', error);
  const embeddingDim = parseInt(process.env.EMBEDDING_DIM || '1024');
  return new Array(embeddingDim).fill(0);
}
}

/**
 * 간단한 해시 함수
 */
function simpleHash(str: string): number {
  try {
    if (!str || typeof str !== 'string') {
      return 0;
    }

    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit 정수로 변환
    }
    return Math.abs(hash);
  } catch (error) {
    console.warn('⚠️ 해시 생성 실패, 기본값 반환:', error);
    return 12345; // 기본 해시값
  }
}

export interface SemanticBoundary {
  position: number; // 텍스트 내 위치 (문자 인덱스)
  similarity: number; // 이전 문장과의 유사도
  confidence: number; // 경계 신뢰도 (0-1)
}

export interface SemanticChunkingConfig {
  minChunkSize: number;
  maxChunkSize: number;
  minSimilarity: number; // 이 값보다 낮으면 경계로 간주
  sentenceOverlap: number; // 청크 간 겹치는 문장 수
}

export class SemanticChunkingService {
  /**
   * 텍스트를 문장 단위로 분할
   */
  private splitIntoSentences(text: string): Array<{ text: string; startIndex: number; endIndex: number }> {
    const sentences: Array<{ text: string; startIndex: number; endIndex: number }> = [];

    // 한국어 및 영어 문장 종결 부호 패턴
    const sentenceEndings = [
      /[.!?。！？]\s+/g,  // 영어/한국어 기본 패턴
      /[.!?]\s*$/g,       // 줄 끝 패턴
      /\n\n+/g,           // 문단 구분
    ];

    let currentIndex = 0;
    let lastMatchIndex = 0;

    // 모든 문장 종결 부호 찾기
    const allMatches: Array<{ index: number; length: number }> = [];

    for (const pattern of sentenceEndings) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        allMatches.push({
          index: match.index,
          length: match[0].length,
        });
      }
    }

    // 인덱스 순으로 정렬
    allMatches.sort((a, b) => a.index - b.index);

    // 중복 제거 및 문장 추출
    for (const match of allMatches) {
      if (match.index >= lastMatchIndex) {
        const sentenceText = text.substring(lastMatchIndex, match.index + match.length).trim();
        if (sentenceText.length > 10) { // 최소 10자 이상인 문장만
          sentences.push({
            text: sentenceText,
            startIndex: lastMatchIndex,
            endIndex: match.index + match.length,
          });
        }
        lastMatchIndex = match.index + match.length;
      }
    }

    // 마지막 문장 처리
    if (lastMatchIndex < text.length) {
      const lastSentence = text.substring(lastMatchIndex).trim();
      if (lastSentence.length > 10) {
        sentences.push({
          text: lastSentence,
          startIndex: lastMatchIndex,
          endIndex: text.length,
        });
      }
    }

    // 문장이 없으면 전체 텍스트를 하나의 문장으로
    if (sentences.length === 0) {
      sentences.push({
        text: text.trim(),
        startIndex: 0,
        endIndex: text.length,
      });
    }

    return sentences;
  }

  /**
   * 문장들 간의 코사인 유사도 계산
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      console.warn('⚠️ 임베딩 차원 불일치:', vec1.length, 'vs', vec2.length);
      return 0;
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * 의미적 경계 탐지
   * 문장 간 유사도가 낮은 지점을 경계로 식별
   */
  async detectSemanticBoundaries(
    text: string,
    config: SemanticChunkingConfig
  ): Promise<SemanticBoundary[]> {
    try {
      // 1. 문장 단위로 분할
      const sentences = this.splitIntoSentences(text);

      if (sentences.length < 2) {
        // 문장이 1개 이하면 경계 없음
        return [];
      }

      console.log(`📝 문장 분할 완료: ${sentences.length}개 문장`);

      // 2. 각 문장에 대한 임베딩 생성 (배치 처리로 최적화)
      console.log(`🔮 문장 임베딩 생성 시작: ${sentences.length}개 문장`);
      const embeddings: number[][] = [];
      const embeddingStartTime = Date.now();

      // 큰 문서는 샘플링하여 성능 최적화
      const maxSentencesForEmbedding = 1000;
      const shouldSample = sentences.length > maxSentencesForEmbedding;

      // 임베딩 생성 타임아웃: 최대 30초 (문장이 많아도 30초 내에 완료되어야 함)
      const EMBEDDING_TIMEOUT = 30000;
      const embeddingTimeoutId = setTimeout(() => {
        console.error(`[CRITICAL] ⏱️ 문장 임베딩 생성 타임아웃: ${EMBEDDING_TIMEOUT}ms 초과 (문장 수: ${sentences.length}개)`);
      }, EMBEDDING_TIMEOUT);

      try {
        const sentenceTexts = sentences.map(s => s.text);

        if (shouldSample) {
          console.log(`⚠️ 문장 수가 많음 (${sentences.length}개) - 샘플링하여 처리`);
          const sampleRate = Math.ceil(sentences.length / maxSentencesForEmbedding);
          const sampledSentences = sentenceTexts.filter((_, index) => index % sampleRate === 0);

          console.log(`📊 샘플링: ${sampledSentences.length}개 문장 선택 (sampleRate: ${sampleRate})`);

          const batchResults = await embeddingService.generateBatchEmbeddings(sampledSentences);
          const sampledEmbeddings = batchResults.map(r => r.embedding);

          // 샘플링된 문장의 임베딩을 모든 문장에 매핑
          for (let i = 0; i < sentences.length; i++) {
            const sampleIndex = Math.floor(i / sampleRate);
            embeddings.push(sampledEmbeddings[sampleIndex] || sampledEmbeddings[sampledEmbeddings.length - 1]);
          }
        } else {
          // 모든 문장에 대해 배치 임베딩 생성
          const batchResults = await embeddingService.generateBatchEmbeddings(sentenceTexts);
          embeddings.push(...batchResults.map(r => r.embedding));
        }

        clearTimeout(embeddingTimeoutId);
        const embeddingElapsed = Date.now() - embeddingStartTime;
        console.log(`✅ 임베딩 생성 및 검증 완료: ${embeddings.length}개 (소요 시간: ${embeddingElapsed}ms)`);
      } catch (embeddingError) {
        clearTimeout(embeddingTimeoutId);
        console.error(`[CRITICAL] ❌ 임베딩 생성 중 에러 발생:`, embeddingError);
        throw embeddingError;
      }

      // 3. 문장 간 유사도 계산
      const boundaries: SemanticBoundary[] = [];

      for (let i = 1; i < sentences.length; i++) {
        const similarity = this.cosineSimilarity(embeddings[i - 1], embeddings[i]);

        // 유사도가 낮으면 경계로 간주
        if (similarity < config.minSimilarity) {
          const confidence = 1 - similarity; // 유사도가 낮을수록 신뢰도 높음

          boundaries.push({
            position: sentences[i].startIndex,
            similarity,
            confidence: Math.min(confidence, 1.0),
          });
        }
      }

      console.log(`📍 의미적 경계 탐지 완료: ${boundaries.length}개 경계 발견`);

      return boundaries;
    } catch (error) {
      console.error('❌ 의미적 경계 탐지 실패:', error);
      // 에러 발생 시 빈 배열 반환 (규칙 기반 청킹으로 폴백)
      return [];
    }
  }

  /**
   * 의미적 경계를 기반으로 청킹
   */
  async chunkBySemanticBoundaries(
    text: string,
    config: SemanticChunkingConfig
  ): Promise<string[]> {
    try {
      // 1. 의미적 경계 탐지
      const boundaries = await this.detectSemanticBoundaries(text, config);

      // 2. 경계가 없으면 최대 크기로 단순 분할
      if (boundaries.length === 0) {
        return this.fallbackChunking(text, config);
      }

      // 3. 경계를 기반으로 청크 생성
      const chunks: string[] = [];
      let startIndex = 0;

      for (const boundary of boundaries) {
        // 최소 크기 확인
        if (boundary.position - startIndex < config.minChunkSize) {
          continue; // 최소 크기 미만이면 다음 경계로
        }

        // 최대 크기 확인
        if (boundary.position - startIndex > config.maxChunkSize) {
          // 최대 크기 초과 시 중간 경계 찾기
          const midPoint = startIndex + Math.floor(config.maxChunkSize * 0.8);
          const chunk = text.substring(startIndex, midPoint).trim();
          if (chunk.length >= config.minChunkSize) {
            chunks.push(chunk);
          }
          startIndex = midPoint;
          continue;
        }

        // 경계에서 청크 생성
        const chunk = text.substring(startIndex, boundary.position).trim();
        if (chunk.length >= config.minChunkSize) {
          chunks.push(chunk);
        }

        // 오버랩 처리 (sentenceOverlap만큼 뒤로 이동)
        const overlapChars = Math.min(
          config.sentenceOverlap * 100, // 문장당 약 100자 가정
          boundary.position - startIndex
        );
        startIndex = boundary.position - overlapChars;
      }

      // 마지막 청크 처리
      if (startIndex < text.length) {
        const lastChunk = text.substring(startIndex).trim();
        if (lastChunk.length >= config.minChunkSize) {
          chunks.push(lastChunk);
        }
      }

      console.log(`✅ 의미 기반 청킹 완료: ${chunks.length}개 청크 생성`);

      return chunks.length > 0 ? chunks : this.fallbackChunking(text, config);
    } catch (error) {
      console.error('❌ 의미 기반 청킹 실패, 폴백 사용:', error);
      return this.fallbackChunking(text, config);
    }
  }

  /**
   * 폴백 청킹 (규칙 기반)
   */
  private fallbackChunking(text: string, config: SemanticChunkingConfig): string[] {
    const chunks: string[] = [];
    let startIndex = 0;

    while (startIndex < text.length) {
      const endIndex = Math.min(startIndex + config.maxChunkSize, text.length);
      let chunk = text.substring(startIndex, endIndex);

      // 문장 경계에서 자르기
      if (endIndex < text.length) {
        const lastSentenceEnd = Math.max(
          chunk.lastIndexOf('. '),
          chunk.lastIndexOf('! '),
          chunk.lastIndexOf('? '),
          chunk.lastIndexOf('。'),
          chunk.lastIndexOf('！'),
          chunk.lastIndexOf('？'),
          chunk.lastIndexOf('\n\n')
        );

        if (lastSentenceEnd > config.minChunkSize) {
          chunk = chunk.substring(0, lastSentenceEnd + 1);
        }
      }

      const trimmedChunk = chunk.trim();
      if (trimmedChunk.length >= config.minChunkSize) {
        chunks.push(trimmedChunk);
      }

      startIndex += chunk.length - (config.sentenceOverlap * 100);
    }

    return chunks;
  }
}

// 싱글톤 인스턴스
export const semanticChunkingService = new SemanticChunkingService();

