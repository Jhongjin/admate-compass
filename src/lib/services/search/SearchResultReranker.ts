/**
 * 검색 결과 재랭킹 서비스
 * 관련성 점수를 기반으로 검색 결과를 재정렬
 * 
 * 목적:
 * - 유사도 점수 외에 추가적인 관련성 지표 고려
 * - 질문 키워드 매칭, 섹션 제목 일치 등 고려
 */

import type { SearchResult } from '../RAGSearchService';

export interface RerankingOptions {
  query: string;
  queryKeywords?: string[];
  boostSectionTitle?: boolean; // 섹션 제목이 질문과 일치하면 점수 부스팅
  boostExactMatch?: boolean; // 정확한 키워드 매칭 시 점수 부스팅
}

/**
 * 검색 결과 재랭킹
 */
export function rerankSearchResults(
  results: SearchResult[],
  options: RerankingOptions
): SearchResult[] {
  const { query, queryKeywords = [], boostSectionTitle = true, boostExactMatch = true } = options;

  // 질문 키워드 추출 (제공되지 않은 경우)
  const keywords = queryKeywords.length > 0
    ? queryKeywords
    : query
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 1)
        .filter(word => !['에', '를', '을', '의', '와', '과', '은', '는', '이', '가', '에 대해', '알려주세요'].includes(word));

  // 각 결과에 관련성 점수 계산
  const scoredResults = results.map(result => {
    let relevanceScore = result.similarity || 0;
    const contentLower = result.content.toLowerCase();
    const titleLower = (result.documentTitle || '').toLowerCase();
    const sectionTitleLower = (result.metadata?.sectionTitle || '').toLowerCase();

    // 1. 정확한 키워드 매칭 부스팅
    if (boostExactMatch) {
      for (const keyword of keywords) {
        const keywordLower = keyword.toLowerCase();
        
        // 콘텐츠에 키워드가 포함된 경우
        if (contentLower.includes(keywordLower)) {
          relevanceScore += 0.05;
          
          // 정확한 단어 매칭 (공백으로 구분)
          const exactMatch = new RegExp(`\\b${keywordLower}\\b`, 'i');
          if (exactMatch.test(result.content)) {
            relevanceScore += 0.1; // 정확한 매칭 추가 보너스
          }
        }
        
        // 문서 제목에 키워드가 포함된 경우
        if (titleLower.includes(keywordLower)) {
          relevanceScore += 0.1;
        }
      }
    }

    // 2. 섹션 제목 일치 부스팅
    if (boostSectionTitle && sectionTitleLower) {
      for (const keyword of keywords) {
        if (sectionTitleLower.includes(keyword.toLowerCase())) {
          relevanceScore += 0.15; // 섹션 제목 일치는 높은 가중치
        }
      }
    }

    // 3. 질문 키워드 밀도 (콘텐츠에 포함된 키워드 비율)
    const matchedKeywords = keywords.filter(keyword => 
      contentLower.includes(keyword.toLowerCase())
    ).length;
    const keywordDensity = keywords.length > 0 ? matchedKeywords / keywords.length : 0;
    relevanceScore += keywordDensity * 0.1;

    // 4. 콘텐츠 길이 보정 (너무 짧거나 긴 콘텐츠는 약간 감점)
    const contentLength = result.content.length;
    if (contentLength < 50) {
      relevanceScore -= 0.05; // 너무 짧은 콘텐츠
    } else if (contentLength > 2000) {
      relevanceScore -= 0.02; // 너무 긴 콘텐츠
    }

    return {
      ...result,
      similarity: Math.min(1.0, relevanceScore), // 최대 1.0으로 제한
      _rerankingScore: relevanceScore, // 디버깅용 (내부 사용)
    };
  });

  // 재랭킹된 결과 정렬
  const reranked = scoredResults.sort((a, b) => {
    const scoreA = a._rerankingScore || a.similarity || 0;
    const scoreB = b._rerankingScore || b.similarity || 0;
    return scoreB - scoreA;
  });

  // 내부 점수 제거
  return reranked.map(({ _rerankingScore, ...result }) => result);
}

