/**
 * 컨텍스트 윈도우 최적화 유틸리티
 * LLM의 컨텍스트 윈도우를 효율적으로 사용하기 위해 검색 결과를 최적화
 * 
 * 목적:
 * - 토큰 사용량 최적화
 * - 가장 관련성 높은 정보 우선 포함
 * - 중복 제거 및 요약
 */

import type { SearchResult } from '../RAGSearchService';

export interface ContextWindowOptions {
  maxTokens?: number; // 최대 토큰 수 (기본값: 4000)
  maxResults?: number; // 최대 검색 결과 수 (기본값: 5)
  minSimilarity?: number; // 최소 유사도 임계값
  prioritizeSectionTitle?: boolean; // 섹션 제목이 있는 결과 우선
}

/**
 * 검색 결과를 컨텍스트 윈도우에 맞게 최적화
 */
export function optimizeContextWindow(
  results: SearchResult[],
  options: ContextWindowOptions = {}
): SearchResult[] {
  const {
    maxTokens = 4000,
    maxResults = 5,
    minSimilarity = 0.1,
    prioritizeSectionTitle = true,
  } = options;

  // 1. 유사도 임계값 필터링
  let filtered = results.filter(result => 
    (result.similarity || 0) >= minSimilarity
  );

  // 2. 섹션 제목이 있는 결과 우선 정렬
  if (prioritizeSectionTitle) {
    filtered = filtered.sort((a, b) => {
      const aHasSection = !!(a.metadata?.sectionTitle);
      const bHasSection = !!(b.metadata?.sectionTitle);
      
      if (aHasSection && !bHasSection) return -1;
      if (!aHasSection && bHasSection) return 1;
      
      // 둘 다 섹션 제목이 있거나 없으면 유사도로 정렬
      return (b.similarity || 0) - (a.similarity || 0);
    });
  }

  // 3. 토큰 수 추정 및 최적화
  // 대략적인 토큰 수 계산 (한국어: 1자 ≈ 0.5 토큰, 영어: 1단어 ≈ 1.3 토큰)
  const estimateTokens = (text: string): number => {
    const koreanChars = (text.match(/[가-힣]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    const otherChars = text.length - koreanChars - englishWords;
    
    return Math.ceil(koreanChars * 0.5 + englishWords * 1.3 + otherChars * 0.3);
  };

  const optimized: SearchResult[] = [];
  let totalTokens = 0;
  const maxContentLength = 800; // 각 결과의 최대 콘텐츠 길이

  for (const result of filtered) {
    if (optimized.length >= maxResults) break;

    // 콘텐츠 길이 제한
    let content = result.content;
    if (content.length > maxContentLength) {
      content = content.substring(0, maxContentLength) + '...';
    }

    const resultTokens = estimateTokens(content) + estimateTokens(result.documentTitle || '');
    const estimatedTotal = totalTokens + resultTokens;

    // 토큰 제한 확인
    if (estimatedTotal <= maxTokens) {
      optimized.push({
        ...result,
        content, // 잘린 콘텐츠 사용
      });
      totalTokens = estimatedTotal;
    } else {
      // 토큰 제한에 도달했지만 아직 결과가 부족한 경우
      // 가장 관련성 높은 결과는 포함 (토큰 초과 허용)
      if (optimized.length === 0 || (result.similarity || 0) > 0.7) {
        optimized.push({
          ...result,
          content,
        });
      }
      break;
    }
  }

  return optimized;
}

/**
 * 중복 검색 결과 제거
 * 동일한 문서나 유사한 콘텐츠를 가진 결과 제거
 */
export function removeDuplicateResults(
  results: SearchResult[],
  options: {
    similarityThreshold?: number; // 콘텐츠 유사도 임계값 (기본값: 0.9)
    sameDocumentOnly?: boolean; // 같은 문서만 제거할지 여부
  } = {}
): SearchResult[] {
  const { similarityThreshold = 0.9, sameDocumentOnly = false } = options;
  
  const unique: SearchResult[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    // 같은 문서 ID 체크
    if (sameDocumentOnly) {
      if (seen.has(result.documentId || '')) {
        continue;
      }
      seen.add(result.documentId || '');
      unique.push(result);
      continue;
    }

    // 콘텐츠 유사도 체크
    let isDuplicate = false;
    for (const existing of unique) {
      // 같은 문서이고 콘텐츠가 유사한 경우
      if (result.documentId === existing.documentId) {
        const contentSimilarity = calculateTextSimilarity(
          result.content,
          existing.content
        );
        
        if (contentSimilarity > similarityThreshold) {
          isDuplicate = true;
          break;
        }
      }
    }

    if (!isDuplicate) {
      unique.push(result);
    }
  }

  return unique;
}

/**
 * 간단한 텍스트 유사도 계산 (Jaccard 유사도 기반)
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

