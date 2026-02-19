/**
 * Cross-Encoder 스타일 재랭킹 서비스
 * 쿼리와 문서 간의 관련성을 더 정교하게 계산하여 검색 결과를 재정렬
 * 
 * Cross-Encoder는 쿼리와 문서를 동시에 입력받아 관련성을 평가하는 모델입니다.
 * 실제 Cross-Encoder 모델을 사용하지 않고도, 다양한 신호를 결합하여 관련성을 평가합니다.
 */

import type { ChunkData } from '../RAGProcessor';

export interface CrossEncoderRerankingOptions {
  query: string;
  queryKeywords?: string[];
  /**
   * 가중치 설정
   */
  weights?: {
    vectorSimilarity?: number; // 벡터 유사도 가중치 (기본: 0.5)
    keywordMatch?: number; // 키워드 매칭 가중치 (기본: 0.2)
    sectionTitle?: number; // 섹션 제목 일치 가중치 (기본: 0.15)
    documentTitle?: number; // 문서 제목 일치 가중치 (기본: 0.1)
    keywordDensity?: number; // 키워드 밀도 가중치 (기본: 0.05)
  };
  /**
   * 최소 관련성 점수 (이 점수 미만은 제외)
   */
  minRelevanceScore?: number;
}

/**
 * TF-IDF 기반 키워드 점수 계산
 */
function calculateTFIDFScore(
  queryKeywords: string[],
  content: string,
  documentTitle: string = ''
): number {
  if (queryKeywords.length === 0) return 0;

  const contentLower = content.toLowerCase();
  const titleLower = documentTitle.toLowerCase();
  const combinedText = `${titleLower} ${contentLower}`;

  let totalScore = 0;
  const wordCounts = new Map<string, number>();
  const totalWords = combinedText.split(/\s+/).length;

  // 각 키워드의 빈도 계산
  for (const keyword of queryKeywords) {
    const keywordLower = keyword.toLowerCase();
    const regex = new RegExp(`\\b${keywordLower}\\b`, 'gi');
    const matches = combinedText.match(regex);
    const frequency = matches ? matches.length : 0;
    
    if (frequency > 0) {
      // TF (Term Frequency): 키워드 빈도 / 전체 단어 수
      const tf = frequency / totalWords;
      
      // 제목에 있으면 가중치 증가
      const titleBoost = titleLower.includes(keywordLower) ? 2.0 : 1.0;
      
      // IDF는 간단히 역빈도로 근사 (실제로는 전체 문서 집합 필요)
      // 여기서는 키워드 길이와 중요도를 고려
      const idf = keyword.length > 3 ? 1.5 : 1.0;
      
      const keywordScore = tf * idf * titleBoost;
      wordCounts.set(keyword, keywordScore);
      totalScore += keywordScore;
    }
  }

  // 정규화 (0-1 범위)
  return Math.min(1.0, totalScore / queryKeywords.length);
}

/**
 * 문장 유사도 점수 계산 (간단한 Jaccard 유사도)
 */
function calculateSentenceSimilarity(query: string, content: string): number {
  const queryWords = new Set(
    query.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 1)
  );
  
  const contentWords = new Set(
    content.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 1)
  );

  if (queryWords.size === 0 || contentWords.size === 0) return 0;

  // 교집합
  const intersection = new Set([...queryWords].filter(w => contentWords.has(w)));
  
  // 합집합
  const union = new Set([...queryWords, ...contentWords]);

  // Jaccard 유사도
  return intersection.size / union.size;
}

/**
 * 키워드 밀도 계산 (쿼리 키워드가 콘텐츠에 포함된 비율)
 */
function calculateKeywordDensity(queryKeywords: string[], content: string): number {
  if (queryKeywords.length === 0) return 0;

  const contentLower = content.toLowerCase();
  const matchedKeywords = queryKeywords.filter(keyword =>
    contentLower.includes(keyword.toLowerCase())
  ).length;

  return matchedKeywords / queryKeywords.length;
}

/**
 * Cross-Encoder 스타일 재랭킹
 * 다양한 신호를 결합하여 관련성 점수를 계산하고 재정렬
 */
export function crossEncoderRerank(
  chunks: ChunkData[],
  options: CrossEncoderRerankingOptions
): ChunkData[] {
  const {
    query,
    queryKeywords = [],
    weights = {},
    minRelevanceScore = 0.1,
  } = options;

  // 기본 가중치
  const {
    vectorSimilarity = 0.5,
    keywordMatch = 0.2,
    sectionTitle = 0.15,
    documentTitle = 0.1,
    keywordDensity = 0.05,
  } = weights;

  // 키워드 추출 (제공되지 않은 경우)
  const keywords = queryKeywords.length > 0
    ? queryKeywords
    : query
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 1)
        .filter(word => !['에', '를', '을', '의', '와', '과', '은', '는', '이', '가', '에 대해', '알려주세요', '어떻게', '무엇', '왜', '언제', '어디'].includes(word));

  // 각 청크에 관련성 점수 계산
  const scoredChunks = chunks.map(chunk => {
    const content = chunk.content || '';
    const docTitle = chunk.metadata?.document_title || '';
    const sectionTitleText = chunk.metadata?.section_title || '';
    
    // 1. 벡터 유사도 점수 (기존 similarity 사용)
    const vectorScore = Math.max(0, Math.min(1, chunk.similarity || 0));

    // 2. TF-IDF 기반 키워드 매칭 점수
    const tfidfScore = calculateTFIDFScore(keywords, content, docTitle);

    // 3. 섹션 제목 일치 점수
    let sectionTitleScore = 0;
    if (sectionTitleText) {
      const sectionTitleLower = sectionTitleText.toLowerCase();
      const matchedKeywords = keywords.filter(keyword =>
        sectionTitleLower.includes(keyword.toLowerCase())
      ).length;
      sectionTitleScore = keywords.length > 0 ? matchedKeywords / keywords.length : 0;
    }

    // 4. 문서 제목 일치 점수
    let docTitleScore = 0;
    if (docTitle) {
      const docTitleLower = docTitle.toLowerCase();
      const matchedKeywords = keywords.filter(keyword =>
        docTitleLower.includes(keyword.toLowerCase())
      ).length;
      docTitleScore = keywords.length > 0 ? matchedKeywords / keywords.length : 0;
    }

    // 5. 키워드 밀도 점수
    const densityScore = calculateKeywordDensity(keywords, content);

    // 6. 문장 유사도 점수 (추가 신호)
    const sentenceSimilarity = calculateSentenceSimilarity(query, content);

    // 최종 관련성 점수 계산 (가중 평균)
    const relevanceScore =
      vectorScore * vectorSimilarity +
      tfidfScore * keywordMatch +
      sectionTitleScore * sectionTitle +
      docTitleScore * documentTitle +
      densityScore * keywordDensity +
      sentenceSimilarity * 0.1; // 문장 유사도는 작은 가중치

    // 최소 관련성 점수 필터링
    if (relevanceScore < minRelevanceScore) {
      return null;
    }

    const finalSimilarity = Math.min(1.0, relevanceScore);
    return {
      ...chunk,
      similarity: finalSimilarity, // 최종 점수를 similarity로 업데이트
      _crossEncoderScore: relevanceScore, // 디버깅용 (내부 사용)
    } as ChunkData & { _crossEncoderScore: number };
  }).filter((chunk): chunk is ChunkData & { _crossEncoderScore: number } => chunk !== null);

  // 관련성 점수 기준으로 정렬
  const reranked = scoredChunks.sort((a, b) => {
    const scoreA = a._crossEncoderScore || a.similarity || 0;
    const scoreB = b._crossEncoderScore || b.similarity || 0;
    return scoreB - scoreA;
  });

  // 내부 점수 제거
  return reranked.map(({ _crossEncoderScore, ...chunk }) => chunk);
}

