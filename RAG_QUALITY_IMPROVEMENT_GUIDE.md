# RAG 서비스 품질 개선 가이드 (90% 이상 달성)

## 📊 일반적인 RAG 서비스 품질 수준

### 업계 표준 벤치마크

| 품질 수준 | 청킹 품질 | 검색 품질 | 설명 |
|---------|---------|---------|------|
| **기본 수준** | 60-70% | 60-70% | MVP 수준, 기본 기능만 동작 |
| **프로덕션 수준** | 70-80% | 70-80% | 일반적인 프로덕션 서비스 |
| **우수한 수준** | 80-90% | 80-90% | 잘 최적화된 서비스 |
| **최고 수준** | 90-95% | 90-95% | 엔터프라이즈급, 최적화 완료 |
| **완벽 수준** | 95-98% | 95-98% | 연구/벤치마크 수준 |

### 현재 시스템 상태
- **청킹 품질**: 70-85% (평균 80%)
- **검색 품질**: 70-85% (평균 72%)
- **전체 평균**: 80.4%
- **평가**: 프로덕션 수준, 우수한 수준에 근접

---

## 🎯 90% 이상 달성을 위한 개선 방안

### 1. 청킹 품질 개선 (현재 70-85% → 목표 90%+)

#### 1.1 메타데이터 강화 (현재 -15% 손실)
**문제점**: 모든 문서에서 "메타데이터가 부족함" 이슈 발생

**개선 방안**:
```typescript
// 현재: 기본 메타데이터만 포함
// 개선: 구조화된 메타데이터 추가

interface EnhancedChunkMetadata {
  // 기본 정보
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  
  // 구조 정보 (필수)
  sectionTitle?: string;      // 섹션 제목
  hierarchyLevel?: number;     // 계층 레벨 (h1=1, h2=2, ...)
  parentSection?: string;     // 상위 섹션
  
  // 의미 정보 (필수)
  keywords?: string[];         // 키워드 추출
  topics?: string[];           // 주제 분류
  importance?: number;         // 중요도 점수 (0-1)
  
  // 컨텍스트 정보
  chunkType?: 'title' | 'text' | 'table' | 'list' | 'code';
  language?: string;           // 언어 감지
  hasNumbers?: boolean;         // 숫자 포함 여부
  hasDates?: boolean;          // 날짜 포함 여부
  
  // 문서 타입별 특화
  pageNumber?: number;         // PDF 페이지 번호
  urlPath?: string;           // URL 경로
  htmlTag?: string;           // HTML 태그 정보
}
```

**구현 방법**:
1. **HTML 구조 분석 강화**
   - `HTMLStructureExtractor` 개선
   - 제목 계층 구조 추출 (h1, h2, h3)
   - 섹션 경계 감지

2. **키워드 추출**
   - TF-IDF 기반 키워드 추출
   - 명사/고유명사 추출 (KoNLPy 사용)
   - 도메인 특화 키워드 사전

3. **중요도 점수 계산**
   - 제목 근접도
   - 키워드 빈도
   - 문서 위치 (앞부분 가중치)

**예상 효과**: +10-15% (70-85% → 85-95%)

---

#### 1.2 청크 크기 최적화
**현재 상태**: 
- URL: 440-744자 (적정)
- PDF: 1199자 (약간 큼)

**개선 방안**:
```typescript
// 문서 타입별 최적 청크 크기
const OPTIMAL_CHUNK_SIZES = {
  pdf: {
    chunkSize: 800,      // 1000 → 800
    chunkOverlap: 120,   // 150 → 120
    reason: 'PDF는 표/이미지 포함으로 실제 텍스트가 적음'
  },
  docx: {
    chunkSize: 700,      // 900 → 700
    chunkOverlap: 100,   // 120 → 100
    reason: 'DOCX는 구조화된 문서로 작은 청크가 효과적'
  },
  txt: {
    chunkSize: 600,      // 800 → 600
    chunkOverlap: 80,    // 100 → 80
    reason: 'TXT는 순수 텍스트로 작은 청크가 검색 정확도 향상'
  },
  url: {
    chunkSize: 500,      // 700 → 500
    chunkOverlap: 60,    // 80 → 60
    reason: 'URL은 HTML 구조를 고려해 작은 청크가 효과적'
  }
};
```

**예상 효과**: +3-5%

---

#### 1.3 커버리지 개선
**현재 상태**: 100-118% (과도한 overlap)

**개선 방안**:
- Overlap 비율 조정 (현재 10-15% → 8-12%)
- 문서 끝부분 처리 개선
- 빈 청크 필터링

**예상 효과**: +2-3%

---

### 2. 검색 품질 개선 (현재 70-85% → 목표 90%+)

#### 2.1 검색 결과 개수 증가 (현재 1-2개 → 목표 3-5개)
**문제점**: 검색 결과가 1-2개로 부족

**개선 방안**:

1. **임계값 조정**
```typescript
// 현재: 0.7 → 0.4 → 0.2 단계적 Fallback
// 개선: 더 공격적인 Fallback 전략

const SEARCH_THRESHOLDS = {
  primary: 0.6,      // 0.7 → 0.6 (더 많은 결과)
  secondary: 0.35,  // 0.4 → 0.35
  tertiary: 0.15,   // 0.2 → 0.15
  minimum: 0.05     // 최소 임계값 추가
};
```

2. **하이브리드 검색 구현**
```typescript
// 벡터 검색 + 키워드 검색 결합
async function hybridSearch(query: string, limit: number) {
  // 1. 벡터 검색 (70% 가중치)
  const vectorResults = await vectorSearch(query, limit * 2);
  
  // 2. 키워드 검색 (30% 가중치)
  const keywordResults = await keywordSearch(query, limit * 2);
  
  // 3. 결과 결합 및 재랭킹
  const combined = combineAndRerank(vectorResults, keywordResults);
  
  return combined.slice(0, limit);
}
```

**예상 효과**: +5-10% (결과 개수 점수 향상)

---

#### 2.2 평균 유사도 향상 (현재 71-72% → 목표 75%+)
**문제점**: 평균 유사도가 71-72%로 낮음

**개선 방안**:

1. **임베딩 모델 최적화**
```typescript
// 현재: OpenAI text-embedding-3-small (1024차원)
// 개선 옵션:
// - text-embedding-3-large (3072차원) - 더 정확하지만 비용 증가
// - BGE-M3 (1024차원) - 한국어 최적화
// - 멀티벡터 임베딩 (문장별 + 문서별)
```

2. **쿼리 확장 (Query Expansion)**
```typescript
// 동의어/관련어 추가
async function expandQuery(query: string): Promise<string> {
  // 1. 동의어 사전 조회
  const synonyms = await getSynonyms(query);
  
  // 2. LLM 기반 쿼리 확장
  const expanded = await llm.expandQuery(query);
  
  // 3. 원본 + 확장 쿼리 결합
  return `${query} ${synonyms.join(' ')} ${expanded}`;
}
```

3. **재랭킹 강화**
```typescript
// 현재: 기본 재랭킹
// 개선: Cross-Encoder 재랭킹

import { CrossEncoder } from '@xenova/transformers';

async function rerankWithCrossEncoder(
  query: string,
  candidates: SearchResult[]
): Promise<SearchResult[]> {
  const model = await CrossEncoder.from_pretrained(
    'cross-encoder/ms-marco-MiniLM-L-6-v2'
  );
  
  const scores = await Promise.all(
    candidates.map(candidate =>
      model.predict([query, candidate.content])
    )
  );
  
  // 점수 기반 재정렬
  return candidates
    .map((c, i) => ({ ...c, rerankScore: scores[i] }))
    .sort((a, b) => b.rerankScore - a.rerankScore);
}
```

**예상 효과**: +8-12% (유사도 점수 향상)

---

#### 2.3 잘린 텍스트 제거 (현재 감지됨 → 목표 없음)
**문제점**: "잘린 텍스트 패턴 감지됨" 이슈

**개선 방안**:

1. **청킹 시점에서 방지**
```typescript
// 숫자/날짜가 포함된 청크는 경계 조정
function adjustChunkBoundary(
  text: string,
  start: number,
  end: number
): { start: number; end: number } {
  // 숫자 패턴 앞뒤로 경계 확장
  const numberPattern = /\d+/g;
  let match;
  
  while ((match = numberPattern.exec(text.substring(start, end))) !== null) {
    const numStart = start + match.index;
    const numEnd = numStart + match[0].length;
    
    // 숫자 앞뒤 50자 확장
    start = Math.max(0, Math.min(start, numStart - 50));
    end = Math.min(text.length, Math.max(end, numEnd + 50));
  }
  
  return { start, end };
}
```

2. **검색 결과 필터링 강화**
```typescript
// 현재: TruncatedTextFilter 사용
// 개선: 더 정교한 패턴 감지

const TRUNCATED_PATTERNS = [
  /\d+\s*\|\s*\d+/,           // 숫자 | 숫자
  /\d+\s*\.\.\./,             // 숫자 ...
  /^\d+$/,                    // 숫자만
  /\d+\s*[가-힣]+\s*\|/,      // 숫자 한글 |
  /\.\.\.\s*\d+/,             // ... 숫자
];

function isTruncatedText(content: string): boolean {
  return TRUNCATED_PATTERNS.some(pattern => pattern.test(content));
}
```

**예상 효과**: +5-8% (잘린 텍스트 점수 회복)

---

### 3. 종합 개선 전략

#### Phase 1: 빠른 개선 (1-2주, +5-10%)
1. ✅ 메타데이터 기본 필드 추가 (sectionTitle, keywords)
2. ✅ 청크 크기 최적화
3. ✅ 검색 임계값 조정
4. ✅ 잘린 텍스트 필터링 강화

**예상 결과**: 80% → 85-90%

#### Phase 2: 중기 개선 (2-4주, +5-8%)
1. 하이브리드 검색 구현
2. 쿼리 확장 기능
3. Cross-Encoder 재랭킹
4. 키워드 추출 강화

**예상 결과**: 85-90% → 90-93%

#### Phase 3: 장기 개선 (1-2개월, +2-5%)
1. 멀티벡터 임베딩
2. 도메인 특화 임베딩 모델 파인튜닝
3. 사용자 피드백 기반 학습
4. A/B 테스트 및 최적화

**예상 결과**: 90-93% → 93-95%

---

## 📈 품질 점수 계산 상세 분석

### 청킹 품질 점수 (최대 100점)

| 항목 | 가중치 | 현재 점수 | 개선 후 목표 |
|------|--------|----------|------------|
| 청크 개수 (1-50개) | 20% | 15-20% | 20% |
| 평균 크기 (500-1000자) | 25% | 20-25% | 25% |
| 커버리지 (95%+) | 25% | 20-25% | 25% |
| 메타데이터 포함 | 15% | **0%** | **15%** |
| 처리 시간 (5초 이내) | 15% | 15% | 15% |
| **합계** | **100%** | **70-85%** | **90-95%** |

### 검색 품질 점수 (최대 100점)

| 항목 | 가중치 | 현재 점수 | 개선 후 목표 |
|------|--------|----------|------------|
| 결과 개수 (3-10개) | 30% | **10-20%** | **30%** |
| 평균 유사도 (0.7+) | 40% | **28-32%** | **36-40%** |
| 잘린 텍스트 없음 | 20% | **0%** | **20%** |
| 처리 시간 (3초 이내) | 10% | 5-10% | 10% |
| **합계** | **100%** | **43-62%** | **90-95%** |

---

## 🎯 우선순위별 개선 작업

### 🔴 최우선 (즉시 개선 가능, 효과 큼)

1. **메타데이터 추가** (+10-15%)
   - `sectionTitle` 추출
   - `keywords` 추출 (TF-IDF)
   - `importance` 점수 계산
   - **예상 시간**: 3-5일

2. **검색 결과 개수 증가** (+5-10%)
   - 임계값 조정 (0.7 → 0.6)
   - Fallback 전략 강화
   - **예상 시간**: 1-2일

3. **잘린 텍스트 필터링 강화** (+5-8%)
   - 패턴 감지 개선
   - 청킹 시점 방지
   - **예상 시간**: 2-3일

### 🟡 중우선 (중기 개선, 효과 중간)

4. **하이브리드 검색** (+5-8%)
   - 키워드 검색 추가
   - 결과 결합 로직
   - **예상 시간**: 1주

5. **쿼리 확장** (+3-5%)
   - 동의어 사전
   - LLM 기반 확장
   - **예상 시간**: 1주

6. **Cross-Encoder 재랭킹** (+3-5%)
   - 모델 통합
   - 재랭킹 파이프라인
   - **예상 시간**: 1주

### 🟢 저우선 (장기 개선, 효과 작음)

7. **임베딩 모델 최적화** (+2-3%)
   - 모델 교체/파인튜닝
   - **예상 시간**: 2-4주

8. **멀티벡터 임베딩** (+2-3%)
   - 문장별 + 문서별 임베딩
   - **예상 시간**: 2-3주

---

## 📊 예상 개선 효과

### 현재 → Phase 1 완료
- 청킹: 80% → **88-92%**
- 검색: 72% → **82-87%**
- 전체: 80.4% → **85-90%**

### Phase 1 → Phase 2 완료
- 청킹: 88-92% → **92-95%**
- 검색: 82-87% → **90-93%**
- 전체: 85-90% → **91-94%**

### Phase 2 → Phase 3 완료
- 청킹: 92-95% → **94-96%**
- 검색: 90-93% → **93-95%**
- 전체: 91-94% → **93-95%**

---

## ✅ 체크리스트

### Phase 1 체크리스트
- [ ] 메타데이터 기본 필드 추가 (sectionTitle, keywords)
- [ ] 청크 크기 최적화 (문서 타입별)
- [ ] 검색 임계값 조정
- [ ] 잘린 텍스트 필터링 강화
- [ ] 품질 점수 재측정

### Phase 2 체크리스트
- [ ] 하이브리드 검색 구현
- [ ] 쿼리 확장 기능
- [ ] Cross-Encoder 재랭킹
- [ ] 키워드 추출 강화
- [ ] 품질 점수 재측정

### Phase 3 체크리스트
- [ ] 멀티벡터 임베딩
- [ ] 도메인 특화 모델 파인튜닝
- [ ] 사용자 피드백 학습
- [ ] A/B 테스트
- [ ] 최종 품질 점수 측정

---

## 📚 참고 자료

- [LangChain Chunking Best Practices](https://python.langchain.com/docs/modules/data_connection/document_transformers/)
- [RAG Evaluation Metrics](https://docs.llamaindex.ai/en/stable/module_guides/evaluating/evaluation/)
- [Vector Search Optimization](https://www.pinecone.io/learn/vector-search-best-practices/)
- [Cross-Encoder Reranking](https://www.sbert.net/examples/applications/cross-encoder/README.html)

