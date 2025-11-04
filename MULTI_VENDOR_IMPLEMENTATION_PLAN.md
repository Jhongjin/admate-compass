# 멀티 벤더 RAG 구현 계획

## 1. 버전5 자동 벤더 감지 구현

### 현재 방식 (키워드 기반) - 정확도 60-70%
```typescript
// 단순 키워드 매칭
if (text.includes("인스타") || text.includes("instagram")) return "Meta";
```

**문제점:**
- 암묵적 언급 ("소셜미디어 광고") 감지 불가
- 복합 벤더 ("Meta와 Google 비교") 처리 어려움
- 도메인 전문 용어 오인 가능

### 개선 방식 (LLM 기반) - 정확도 85-95%

**구현:**
1. `/api/detect-vendors` API 엔드포인트 생성
2. Gemini API로 질문 분석 → 관련 벤더 추출
3. 신뢰도 점수 포함하여 반환

**프롬프트 예시:**
```
다음 질문을 분석하여 관련된 광고 플랫폼을 추출하세요:
- Meta (Facebook, Instagram, Threads)
- Naver (네이버 검색광고)
- Kakao (카카오 비즈보드)
- Google (구글 광고)
- X (Twitter)

질문: "{query}"

응답 형식: JSON
{
  "vendors": ["META", "GOOGLE"],
  "confidence": 0.9,
  "reasoning": "인스타그램과 구글 광고 정책 비교 질문"
}
```

## 2. 벤더 필터링 RAG 검색 구현

### 현재 `search_documents` 함수
```sql
-- 벤더 필터링 없음
SELECT dc.* FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE similarity > threshold
```

### 개선: 벤더 필터 파라미터 추가

**수정된 함수:**
```sql
CREATE OR REPLACE FUNCTION search_documents(
    query_embedding vector(1024),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10,
    vendor_filter TEXT[] DEFAULT NULL  -- 추가
)
RETURNS TABLE (...)
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        dc.chunk_id,
        dc.content,
        dc.metadata,
        1 - (dc.embedding <=> query_embedding) as similarity,
        dc.document_id,
        d.title
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
      AND (vendor_filter IS NULL OR d.source_vendor = ANY(vendor_filter))  -- 필터 추가
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
```

**TypeScript 호출:**
```typescript
// 버전5: 자동 감지된 벤더
const detectedVendors = await detectVendors(query);
const chunks = await supabase.rpc('search_documents', {
  query_embedding: embedding,
  vendor_filter: detectedVendors.map(v => v.toUpperCase())
});

// 버전2-4: 사용자 선택 벤더
const chunks = await supabase.rpc('search_documents', {
  query_embedding: embedding,
  vendor_filter: selectedVendors.map(v => v.toUpperCase())
});
```

## 3. DB 구조 재설계 제안

### 현재 구조 (이미 멀티벤더 지원)
✅ `documents.source_vendor` 컬럼 존재
✅ `idx_documents_source_vendor` 인덱스 존재

### 추가 최적화 제안

#### A. 복합 인덱스 추가 (검색 성능 향상)
```sql
-- 벤더 + 상태 조합 인덱스
CREATE INDEX IF NOT EXISTS idx_documents_vendor_status 
ON documents(source_vendor, status) 
WHERE status = 'indexed';

-- 벤더별 임베딩 검색 최적화를 위한 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_chunks_vendor_embedding
ON document_chunks(document_id)
INCLUDE (embedding)
WHERE EXISTS (
  SELECT 1 FROM documents d 
  WHERE d.id = document_chunks.document_id 
  AND d.status = 'indexed'
);
```

#### B. 벤더별 통계 테이블 (선택사항)
```sql
CREATE TABLE IF NOT EXISTS vendor_statistics (
  vendor TEXT PRIMARY KEY,
  total_documents INT DEFAULT 0,
  total_chunks INT DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  avg_chunk_size INT DEFAULT 0
);

-- 트리거로 자동 업데이트
CREATE OR REPLACE FUNCTION update_vendor_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE vendor_statistics
  SET 
    total_documents = (
      SELECT COUNT(*) FROM documents 
      WHERE source_vendor = NEW.source_vendor AND status = 'indexed'
    ),
    total_chunks = (
      SELECT COUNT(*) FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      WHERE d.source_vendor = NEW.source_vendor
    ),
    last_updated = NOW()
  WHERE vendor = NEW.source_vendor;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

#### C. 벤더별 임베딩 모델 분리 (고급, 선택사항)
현재: 모든 벤더가 동일 임베딩 모델(BGE-M3)
개선: 벤더별 특화 임베딩 모델 고려
- 장점: 벤더별 전문 용어 정확도 향상
- 단점: 복잡도 증가, 관리 비용 상승
- **권장**: 초기에는 단일 모델 유지, 추후 필요 시 도입

## 4. 구현 우선순위

### Phase 1: 즉시 구현 (필수)
1. ✅ `search_documents` 함수에 `vendor_filter` 파라미터 추가
2. ✅ `/api/detect-vendors` 엔드포인트 구현 (LLM 기반)
3. ✅ 버전5 UI에서 자동 감지 벤더 표시
4. ✅ 버전2-4에서 선택 벤더 필터 적용

### Phase 2: 성능 최적화 (1주 내)
1. 복합 인덱스 추가
2. 벤더별 통계 테이블 (대시보드용)
3. 캐싱 레이어 추가 (자주 검색되는 벤더 조합)

### Phase 3: 고급 기능 (선택)
1. 벤더별 임베딩 모델 분리
2. 크로스 벤더 비교 모드
3. 벤더별 프롬프트 템플릿 최적화

## 5. 정확도 비교

| 방식 | 정확도 | 구현 난이도 | 비용 |
|------|--------|------------|------|
| 키워드 매칭 | 60-70% | 낮음 | 낮음 |
| LLM 기반 (Gemini) | 85-95% | 중간 | 중간 |
| Fine-tuned 분류 모델 | 95%+ | 높음 | 높음 |

**권장:** LLM 기반 (Phase 1) → 필요 시 Fine-tuning (Phase 3)

## 6. 구현 체크리스트

- [ ] `/api/detect-vendors` 엔드포인트 구현
- [ ] `search_documents` 함수 수정 (vendor_filter 추가)
- [ ] RAGProcessor에서 벤더 필터 지원
- [ ] 버전5 UI에서 감지 벤더 표시
- [ ] 버전2-4에서 선택 벤더 필터 적용
- [ ] 복합 인덱스 추가
- [ ] 벤더별 통계 테이블 생성
- [ ] 테스트 케이스 작성



