# 검색 품질 개선 계획

## 🔍 현재 문제점 분석

### 1. 검색 결과가 전혀 나오지 않음 (0개 결과)
- **원인**: `RAGSearchService.searchSimilarChunks`가 벡터 검색을 사용하지 않음
- **현재 구현**: 단순히 `document_chunks` 테이블에서 `limit(limit * 2)`로 데이터를 가져온 후 클라이언트에서 유사도 계산
- **문제**: 벡터 유사도 검색이 아닌 단순 데이터 조회

### 2. 임베딩 서비스 문제
- **현재**: `SimpleEmbeddingService`가 해시 기반 임베딩 사용 (의미 기반 검색 불가)
- **문제**: 실제 의미 기반 벡터 검색이 불가능

### 3. 테스트 API가 잘못된 서비스 사용
- **현재**: `RAGSearchService` 사용 (벡터 검색 미구현)
- **올바른 방법**: `RAGProcessor.searchSimilarChunks` 사용 (실제 벡터 검색 구현됨)

### 4. 벡터 검색 함수 미사용
- **현재**: Supabase의 `match_document_chunks` RPC 함수나 `performVectorSearch` 미사용
- **문제**: pgvector의 벡터 유사도 검색 기능을 활용하지 않음

---

## 🎯 개선 방안

### 우선순위 1: RAGSearchService 벡터 검색 구현 (긴급)

#### 1.1 Supabase 벡터 검색 함수 사용
- **목표**: `RAGSearchService.searchSimilarChunks`를 실제 벡터 검색으로 변경
- **방법**: 
  - `RAGProcessor.performVectorSearch` 로직 참고
  - Supabase RPC 함수 `match_document_chunks` 또는 `search_documents_with_weights` 사용
  - pgvector의 `<=>` 연산자 활용

#### 1.2 임베딩 서비스 개선
- **목표**: 해시 기반 임베딩 대신 실제 임베딩 모델 사용
- **방법**:
  - `OpenAIEmbeddingService` 사용 (이미 구현되어 있음)
  - 또는 `BGE-M3` 모델 사용
  - `SimpleEmbeddingService`는 fallback으로만 사용

#### 1.3 검색 쿼리 최적화
- **목표**: 벡터 검색 쿼리 성능 및 정확도 향상
- **방법**:
  - 적절한 `match_threshold` 설정 (0.3 ~ 0.7 범위)
  - 단계적 fallback 검색 전략 (높은 임계값 → 낮은 임계값)
  - 인덱스 최적화 확인

---

### 우선순위 2: 테스트 API 수정

#### 2.1 올바른 서비스 사용
- **변경**: `test/chunking-quality/route.ts`에서 `RAGSearchService` 대신 `RAGProcessor` 사용
- **이유**: `RAGProcessor`가 실제 벡터 검색을 구현하고 있음

#### 2.2 검색 결과 디버깅 정보 추가
- **추가**: 검색 과정의 상세 로그
  - 임베딩 생성 여부
  - 벡터 검색 쿼리 실행 여부
  - 결과 개수 및 유사도 분포
  - 필터링/재랭킹 전후 비교

---

### 우선순위 3: 데이터베이스 최적화

#### 3.1 벡터 인덱스 확인
- **확인**: `document_chunks.embedding` 컬럼에 HNSW 인덱스 존재 여부
- **생성**: 인덱스가 없으면 생성
  ```sql
  CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx 
  ON document_chunks 
  USING hnsw (embedding vector_cosine_ops);
  ```

#### 3.2 임베딩 데이터 검증
- **확인**: 모든 청크에 임베딩이 제대로 저장되어 있는지 확인
- **쿼리**:
  ```sql
  SELECT 
    COUNT(*) as total_chunks,
    COUNT(embedding) as chunks_with_embedding,
    COUNT(*) - COUNT(embedding) as chunks_without_embedding
  FROM document_chunks;
  ```

#### 3.3 벡터 차원 일치 확인
- **확인**: 쿼리 임베딩과 저장된 임베딩의 차원이 일치하는지 확인
- **문제**: `SimpleEmbeddingService`는 768차원, OpenAI는 1024차원일 수 있음

---

### 우선순위 4: 하이브리드 검색 구현

#### 4.1 키워드 검색 추가
- **목표**: 벡터 검색과 키워드 검색을 결합
- **방법**:
  - 벡터 검색 결과와 키워드 검색 결과를 결합
  - BM25 점수와 벡터 유사도를 가중 평균

#### 4.2 메타데이터 필터링 강화
- **목표**: 문서 타입, 벤더, 날짜 등 메타데이터 기반 필터링
- **방법**: 벡터 검색 전/후에 메타데이터 필터 적용

---

### 우선순위 5: 검색 결과 품질 향상

#### 5.1 재랭킹 개선
- **현재**: `SearchResultReranker` 사용 중
- **개선**:
  - 더 정교한 관련성 점수 계산
  - 쿼리 확장 (동의어, 관련어 추가)
  - 문서 중요도 가중치 적용

#### 5.2 필터링 로직 개선
- **현재**: `TruncatedTextFilter` 사용 중
- **개선**:
  - 더 정확한 잘린 텍스트 감지
  - 컨텍스트 기반 필터링 (주변 텍스트 고려)

---

## 📋 구현 체크리스트

### Phase 1: 긴급 수정 (1-2일)
- [ ] `RAGSearchService.searchSimilarChunks`를 벡터 검색으로 변경
- [ ] `SimpleEmbeddingService` 대신 `OpenAIEmbeddingService` 사용
- [ ] 테스트 API에서 `RAGProcessor` 사용하도록 수정
- [ ] 벡터 인덱스 확인 및 생성

### Phase 2: 데이터 검증 (1일)
- [ ] 임베딩 데이터 존재 여부 확인
- [ ] 벡터 차원 일치 확인
- [ ] 샘플 검색 쿼리로 동작 확인

### Phase 3: 최적화 (2-3일)
- [ ] 하이브리드 검색 구현
- [ ] 재랭킹 로직 개선
- [ ] 성능 모니터링 추가

### Phase 4: 테스트 및 검증 (1일)
- [ ] 실제 데이터로 검색 품질 테스트
- [ ] 검색 결과 품질 점수 개선 확인
- [ ] 사용자 피드백 수집

---

## 🔧 기술적 세부사항

### 벡터 검색 구현 예시

```typescript
// RAGSearchService.searchSimilarChunks 개선안
async searchSimilarChunks(
  query: string,
  limit: number = 5,
  similarityThreshold: number = 0.1
): Promise<SearchResult[]> {
  // 1. 질문을 임베딩으로 변환 (OpenAI 사용)
  const queryEmbedding = await this.embeddingService.generateEmbedding(query);
  
  // 2. Supabase 벡터 검색 RPC 함수 호출
  const { data, error } = await this.supabase.rpc('match_document_chunks', {
    query_embedding: queryEmbedding.embedding,
    match_threshold: similarityThreshold,
    match_count: limit * 2
  });
  
  // 3. 결과 처리 및 재랭킹
  // ...
}
```

### Supabase RPC 함수 예시

```sql
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  chunk_id text,
  content text,
  document_id text,
  similarity float,
  metadata jsonb
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.chunk_id,
    dc.content,
    dc.document_id,
    1 - (dc.embedding <=> query_embedding) as similarity,
    dc.metadata
  FROM document_chunks dc
  WHERE dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

---

## 📊 예상 개선 효과

### Before (현재)
- 검색 결과: 0개
- 평균 유사도: 0.0%
- 품질 점수: 40.0% (개선 필요)

### After (개선 후)
- 검색 결과: 3-10개 (예상)
- 평균 유사도: 0.5-0.8 (예상)
- 품질 점수: 70-85% (양호/우수)

---

## ⚠️ 주의사항

1. **임베딩 차원 일치**: 쿼리 임베딩과 저장된 임베딩의 차원이 반드시 일치해야 함
2. **인덱스 성능**: HNSW 인덱스가 없으면 검색이 매우 느려질 수 있음
3. **임계값 조정**: 너무 낮으면 노이즈가 많고, 너무 높으면 결과가 없을 수 있음
4. **비용**: OpenAI 임베딩 API 사용 시 비용 발생

---

## 📝 참고 자료

- [Supabase pgvector 문서](https://supabase.com/docs/guides/database/extensions/pgvector)
- [RAGProcessor.ts](./src/lib/services/RAGProcessor.ts) - 실제 벡터 검색 구현 참고
- [OpenAI Embeddings API](https://platform.openai.com/docs/guides/embeddings)

