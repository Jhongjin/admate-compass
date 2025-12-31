/**
 * 하이브리드 검색 서비스
 * 벡터 검색과 키워드 검색을 결합하여 검색 품질 향상
 * 
 * 전략:
 * - 벡터 검색: 의미적 유사도 기반 (70% 가중치)
 * - 키워드 검색: 정확한 키워드 매칭 (30% 가중치)
 * - 결과 결합 및 재랭킹
 */

import type { ChunkData } from '../RAGProcessor';

export interface HybridSearchResult extends ChunkData {
  hybridScore?: number; // 결합된 점수 (0-1)
  vectorScore?: number; // 벡터 검색 점수
  keywordScore?: number; // 키워드 검색 점수
}

export interface HybridSearchOptions {
  vectorWeight?: number; // 벡터 검색 가중치 (기본값: 0.7)
  keywordWeight?: number; // 키워드 검색 가중치 (기본값: 0.3)
  maxResults?: number; // 최대 결과 개수
  deduplicate?: boolean; // 중복 제거 여부
}

/**
 * 하이브리드 검색 결과 결합 및 재랭킹
 */
export function combineHybridSearchResults(
  vectorResults: ChunkData[],
  keywordResults: ChunkData[],
  options: HybridSearchOptions = {}
): ChunkData[] {
  const {
    vectorWeight = 0.7,
    keywordWeight = 0.3,
    maxResults = 10,
    deduplicate = true,
  } = options;

  // 벡터 검색 결과를 맵으로 변환 (chunk_id 기준)
  const vectorMap = new Map<string, ChunkData>();
  vectorResults.forEach(result => {
    const chunkId = result.chunkId || result.id || '';
    if (chunkId) {
      vectorMap.set(chunkId, result);
    }
  });

  // 키워드 검색 결과를 맵으로 변환 (chunk_id 기준)
  const keywordMap = new Map<string, ChunkData>();
  keywordResults.forEach(result => {
    const chunkId = result.chunkId || result.id || '';
    if (chunkId) {
      keywordMap.set(chunkId, result);
    }
  });

  // 모든 고유한 chunk_id 수집
  const allChunkIds = new Set<string>();
  vectorResults.forEach(r => {
    const id = r.chunkId || r.id || '';
    if (id) allChunkIds.add(id);
  });
  keywordResults.forEach(r => {
    const id = r.chunkId || r.id || '';
    if (id) allChunkIds.add(id);
  });

  // 하이브리드 점수 계산
  const hybridResults: ChunkData[] = [];

  for (const chunkId of allChunkIds) {
    const vectorResult = vectorMap.get(chunkId);
    const keywordResult = keywordMap.get(chunkId);

    // 벡터 점수 (유사도, 0-1 범위로 정규화)
    const vectorScore = vectorResult
      ? Math.min(1, Math.max(0, vectorResult.similarity || 0))
      : 0;

    // 키워드 점수 (키워드 매칭 개수 기반, 0-1 범위로 정규화)
    // 키워드 검색 결과가 있으면 1.0, 없으면 0.0
    // 여러 키워드가 매칭되면 더 높은 점수 (향후 개선 가능)
    const keywordScore = keywordResult ? 1.0 : 0.0;

    // 하이브리드 점수 계산
    const hybridScore = (vectorScore * vectorWeight) + (keywordScore * keywordWeight);

    // 결과 생성 (벡터 결과 우선, 없으면 키워드 결과 사용)
    const baseResult = vectorResult || keywordResult;
    if (!baseResult) continue;

    hybridResults.push({
      ...baseResult,
      // 하이브리드 점수를 similarity로 사용 (재랭킹에 활용)
      similarity: hybridScore,
    });
  }

  // 하이브리드 점수 기준으로 정렬 (similarity 사용)
  hybridResults.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

  // 중복 제거 (같은 문서의 여러 청크 중 최고 점수만 유지)
  let finalResults: ChunkData[] = [];
  if (deduplicate) {
    const documentMap = new Map<string, ChunkData>();
    
    for (const result of hybridResults) {
      const docId = result.documentId || result.metadata?.document_id || '';
      if (!docId) {
        finalResults.push(result);
        continue;
      }

      const existing = documentMap.get(docId);
      const resultScore = result.similarity || 0;
      const existingScore = existing?.similarity || 0;
      
      if (!existing || resultScore > existingScore) {
        documentMap.set(docId, result);
      }
    }

    finalResults = Array.from(documentMap.values());
    // 다시 정렬 (similarity 기준)
    finalResults.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
  } else {
    finalResults = hybridResults;
  }

  // 최대 결과 개수 제한
  return finalResults.slice(0, maxResults);
}

/**
 * 키워드 검색 결과에 점수 부여
 * (향후 개선: 키워드 매칭 개수, 위치, 빈도 등 고려)
 */
export function scoreKeywordResults(
  results: ChunkData[],
  queryKeywords: string[]
): ChunkData[] {
  return results.map(result => {
    const content = (result.content || '').toLowerCase();
    let matchCount = 0;
    
    // 키워드 매칭 개수 계산
    queryKeywords.forEach(keyword => {
      if (content.includes(keyword.toLowerCase())) {
        matchCount++;
      }
    });

    // 매칭 비율 기반 점수 (0-1)
    const keywordScore = queryKeywords.length > 0
      ? matchCount / queryKeywords.length
      : 0;

    return {
      ...result,
      similarity: keywordScore, // 키워드 점수를 similarity로 사용
    };
  });
}

