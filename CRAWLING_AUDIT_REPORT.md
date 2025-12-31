# 크롤링 관련 점검 보고서

## 📋 점검 일자
2025-12-31

## 🔍 점검 항목

### 1. 문서(PDF, DOCX, TXT) 크롤링과 URL 크롤링 독립성 체크

#### ✅ 현재 상태
- **문서 업로드 경로**: `/api/admin/upload-new` (파일 업로드)
- **URL 크롤링 경로**: `/api/admin/save-crawled-content` (URL 크롤링 결과 저장)
- **처리 파이프라인**: 
  - 문서: `upload-new` → `RAGProcessor.processDocument()` → 통합 청킹
  - URL: `save-crawled-content` → `RAGProcessor.processDocument()` → 통합 청킹

#### ⚠️ 발견된 문제점

1. **공통 처리 파이프라인 사용**
   - 문서와 URL 모두 `RAGProcessor.processDocument()`를 통해 처리
   - `chunkDocumentWithUnifiedService()`에서 문서 타입만 구분하여 처리
   - 실제로는 동일한 청킹 로직 사용

2. **문서 타입 구분 로직**
   ```typescript
   // RAGProcessor.ts:2289-2294
   const docType = (document.file_type || document.type || 'txt').toLowerCase();
   let documentType: 'pdf' | 'docx' | 'txt' | 'url' = 'txt';
   if (docType.includes('pdf')) documentType = 'pdf';
   else if (docType.includes('docx') || docType.includes('doc')) documentType = 'docx';
   else if (docType.includes('url') || document.url) documentType = 'url';
   else documentType = 'txt';
   ```
   - 문서 타입은 구분되지만, 실제 청킹 옵션은 동일 (chunkSize: 800, chunkOverlap: 100)

3. **청킹 서비스 통합**
   - `UnifiedChunkingService`가 모든 문서 타입을 처리
   - `TextChunkingService.chunkDocument()`에서 문서 타입별 분기 처리
   ```typescript
   // TextChunkingService.ts:272-288
   async chunkDocument(
     text: string,
     documentType: 'pdf' | 'docx' | 'txt' | 'url',
     metadata: Record<string, any> = {}
   ): Promise<ChunkedDocument> {
     switch (documentType) {
       case 'pdf':
       case 'docx':
       case 'txt':
         return this.chunkKoreanText(text, metadata);
       case 'url':
         // URL은 다양한 콘텐츠 타입이 섞여있으므로 일반 청킹 사용
         return this.chunkText(text, metadata);
       default:
         return this.chunkText(text, metadata);
     }
   }
   ```

#### 📊 평가
- ✅ **독립성**: 부분적으로 독립 (입력 경로는 분리, 처리 파이프라인은 공통)
- ⚠️ **구분성**: 문서 타입은 구분되지만 청킹 옵션이 동일
- ✅ **확장성**: 문서 타입별 커스터마이징 가능한 구조

---

### 2. 크롤링 이후 임베딩 및 청킹이 RAG에 최적화되어 있는지 체크

#### ✅ 현재 상태

**청킹 설정:**
- 청크 크기: 800자 (표준)
- 청크 Overlap: 100자 (표준)
- 분할 기준: `['\n\n', '\n', '.', '!', '?', ';', ' ', '']`
- 한국어 특화 청킹 지원 (`chunkKoreanText`)

**임베딩 설정:**
- 기본 모델: BGE-M3 (1024차원)
- 대안: OpenAI (1536차원)
- Fallback: 해시 임베딩 (환경 변수로 활성화)
- 배치 처리: 25개씩 병렬 처리

**RAG 최적화 기능:**
- ✅ AdaptiveChunkingService: 문서 크기에 따라 청크 크기 조정
- ✅ 강제 재청킹: 1개 청크만 생성된 경우 재청킹
- ✅ OpenAI 토큰 제한 고려: `normalizeChunksForEmbeddingProvider()`
- ✅ 메타데이터 보강: 문서 ID, 청크 인덱스, 출처 정보

#### ⚠️ 발견된 문제점

1. **고정된 청크 크기**
   - 모든 문서 타입에 대해 800자 고정
   - URL 콘텐츠는 HTML 구조가 다를 수 있으나 동일한 크기 사용
   - FAQ 페이지와 긴 정책 문서가 동일한 청크 크기

2. **Overlap 최적화 부족**
   - 100자 고정 Overlap
   - 문서 타입별 최적 Overlap 크기 미적용
   - 문맥 손실 가능성

3. **임베딩 모델 선택**
   - BGE-M3가 기본이지만 한국어 성능 검증 필요
   - OpenAI 임베딩은 토큰 제한으로 인해 청크 크기 조정 필요
   - 모델별 최적 청크 크기 차이 미고려

4. **메타데이터 부족**
   - URL 크롤링 시 페이지 구조 정보 미포함 (예: 섹션, 헤딩)
   - 문서 타입별 특화 메타데이터 부족

#### 📊 평가
- ✅ **기본 최적화**: 표준 청킹 및 임베딩 파이프라인 구축됨
- ⚠️ **고급 최적화**: 문서 타입별 최적화 부족
- ⚠️ **RAG 특화**: 검색 품질 향상을 위한 추가 최적화 여지

---

### 3. LLM 모델이 수집된 문서 기반으로 답변하도록 프롬프트 구성 체크

#### ✅ 현재 상태

**프롬프트 구성 위치:**
- `src/app/api/chat/route.ts`: `buildMultiVendorPrompt()` 함수
- `src/lib/services/GeminiService.ts`: `getDefaultSystemPrompt()` 메서드

**할루시네이션 방지 규칙:**
- ✅ 문서 외 정보 사용 금지
- ✅ 추측 금지 ("아마도", "추정됩니다" 등)
- ✅ 웹 검색 금지
- ✅ 추론 금지
- ✅ 일반 지식 사용 금지
- ✅ 숫자/금액 정보 추론 금지 (특히 잘린 텍스트 처리)

**문서 기반 답변 강제:**
- ✅ "참고 문서" 섹션에 검색된 문서 내용 포함
- ✅ 출처 명시 필수 ([출처 X] 형태)
- ✅ 문서에 없는 정보는 "찾을 수 없습니다" 응답
- ✅ 답변 전 최종 확인 체크리스트 포함

#### ⚠️ 발견된 문제점

1. **프롬프트 길이**
   - `buildMultiVendorPrompt()` 함수가 매우 길고 복잡 (1000+ 줄)
   - 중복된 규칙과 예시가 많음
   - 유지보수 어려움

2. **규칙 일관성**
   - 할루시네이션 방지 규칙이 여러 곳에 분산
   - `buildMultiVendorPrompt()`와 `GeminiService.getDefaultSystemPrompt()`에 중복 규칙
   - 규칙 업데이트 시 여러 곳 수정 필요

3. **검색 결과 필터링**
   - 잘린 텍스트나 불완전한 정보를 프롬프트에 포함
   - "제외된 출처" 섹션으로 처리하지만 사전 필터링 부족

4. **벤더별 특화**
   - 벤더별 가이드라인이 있지만 구체적인 예시 부족
   - 벤더별 특화 프롬프트 템플릿 미구현

#### 📊 평가
- ✅ **할루시네이션 방지**: 강력한 규칙과 체크리스트 포함
- ✅ **문서 기반 답변**: 명확한 지시사항
- ⚠️ **프롬프트 구조**: 개선 여지 (모듈화, 재사용성)
- ⚠️ **검색 결과 품질**: 사전 필터링 강화 필요

---

## 🎯 개선 계획

### 우선순위 1: 문서 타입별 청킹 최적화

#### 목표
- PDF, DOCX, TXT, URL 각각에 최적화된 청킹 전략 적용
- RAG 검색 품질 향상

#### 작업 내용
1. **문서 타입별 청킹 전략 분리**
   - `DocumentTypeChunkingStrategy` 인터페이스 생성
   - 각 문서 타입별 전략 클래스 구현:
     - `PDFChunkingStrategy`: 표/이미지 캡션 고려, 페이지 단위 청킹
     - `DOCXChunkingStrategy`: 헤딩/섹션 구조 고려
     - `TXTChunkingStrategy`: 현재 로직 유지 (한국어 특화)
     - `URLChunkingStrategy`: HTML 구조 고려, 섹션/헤딩 기반 청킹

2. **청크 크기 최적화**
   - PDF: 1000자 (표/이미지 포함 고려)
   - DOCX: 900자 (헤딩 구조 고려)
   - TXT: 800자 (현재 유지)
   - URL: 700자 (HTML 구조 고려, 더 작은 청크로 정확도 향상)

3. **Overlap 최적화**
   - PDF: 150자 (표 경계 보존)
   - DOCX: 120자 (섹션 경계 보존)
   - TXT: 100자 (현재 유지)
   - URL: 80자 (섹션 경계 보존)

4. **메타데이터 보강**
   - URL: 페이지 섹션, 헤딩 레벨 정보 추가
   - PDF: 페이지 번호, 표/이미지 여부
   - DOCX: 헤딩 레벨, 섹션 정보

#### 예상 효과
- 검색 정확도 10-15% 향상
- 컨텍스트 손실 감소
- 문서 타입별 특화된 검색 결과

---

### 우선순위 2: 프롬프트 모듈화 및 재사용성 향상

#### 목표
- 프롬프트 구조 개선으로 유지보수성 향상
- 할루시네이션 방지 규칙 중앙 관리

#### 작업 내용
1. **프롬프트 빌더 패턴 적용**
   - `PromptBuilder` 클래스 생성
   - 모듈별 프롬프트 컴포넌트 분리:
     - `HallucinationPreventionRules`: 할루시네이션 방지 규칙
     - `DocumentBasedAnswerRules`: 문서 기반 답변 규칙
     - `VendorSpecificGuidelines`: 벤더별 가이드라인
     - `AnswerFormatGuidelines`: 답변 형식 가이드라인

2. **프롬프트 템플릿 시스템**
   - 벤더별 프롬프트 템플릿 생성
   - 동적 프롬프트 생성 (검색 결과 기반)

3. **검색 결과 사전 필터링**
   - 잘린 텍스트 감지 및 제외
   - 불완전한 숫자 정보 필터링
   - 품질 점수 기반 필터링

#### 예상 효과
- 프롬프트 유지보수 시간 50% 감소
- 규칙 일관성 향상
- 검색 결과 품질 향상

---

### 우선순위 3: 임베딩 모델 최적화

#### 목표
- 한국어 성능 최적화
- 문서 타입별 최적 임베딩 모델 선택

#### 작업 내용
1. **임베딩 모델 성능 평가**
   - BGE-M3 vs OpenAI 한국어 성능 비교
   - 문서 타입별 최적 모델 선택

2. **하이브리드 임베딩 전략**
   - 문서 타입별 최적 모델 선택
   - 벤더별 최적 모델 선택 (예: Naver → BGE-M3, Meta → OpenAI)

3. **임베딩 품질 모니터링**
   - 검색 정확도 추적
   - 임베딩 품질 메트릭 수집

#### 예상 효과
- 검색 정확도 5-10% 향상
- 벤더별 최적화된 검색 결과

---

### 우선순위 4: 검색 결과 품질 향상

#### 목표
- 불완전한 정보 사전 필터링
- 검색 결과 재랭킹

#### 작업 내용
1. **검색 결과 필터링 강화**
   - 잘린 텍스트 패턴 감지
   - 불완전한 숫자 정보 필터링
   - 품질 점수 계산 및 필터링

2. **검색 결과 재랭킹**
   - 질문과의 관련성 점수 계산
   - 문서 타입별 가중치 적용
   - 벤더별 가중치 적용

3. **컨텍스트 윈도우 최적화**
   - 질문 관련성 높은 청크 우선 선택
   - 컨텍스트 길이 제한 내 최적 청크 조합

#### 예상 효과
- 답변 정확도 15-20% 향상
- 할루시네이션 발생률 감소

---

## 📝 구현 로드맵

### Phase 1: 문서 타입별 청킹 최적화 (2주)
- [ ] `DocumentTypeChunkingStrategy` 인터페이스 생성
- [ ] 각 문서 타입별 전략 클래스 구현
- [ ] 청크 크기 및 Overlap 최적화
- [ ] 메타데이터 보강
- [ ] 테스트 및 검증

### Phase 2: 프롬프트 모듈화 (1주)
- [ ] `PromptBuilder` 클래스 생성
- [ ] 프롬프트 컴포넌트 분리
- [ ] 벤더별 템플릿 생성
- [ ] 기존 프롬프트 마이그레이션

### Phase 3: 검색 결과 품질 향상 (1주)
- [ ] 검색 결과 필터링 강화
- [ ] 검색 결과 재랭킹
- [ ] 컨텍스트 윈도우 최적화
- [ ] 테스트 및 검증

### Phase 4: 임베딩 모델 최적화 (2주)
- [ ] 임베딩 모델 성능 평가
- [ ] 하이브리드 임베딩 전략 구현
- [ ] 임베딩 품질 모니터링
- [ ] 테스트 및 검증

---

## 📊 예상 개선 효과

### 정량적 효과
- 검색 정확도: +15-20%
- 답변 정확도: +20-25%
- 할루시네이션 발생률: -30-40%
- 프롬프트 유지보수 시간: -50%

### 정성적 효과
- 문서 타입별 최적화된 검색 결과
- 일관된 프롬프트 관리
- 향상된 답변 품질
- 유지보수성 향상

---

## 🔗 관련 파일

### 현재 구조
- `src/lib/services/RAGProcessor.ts`: RAG 처리 메인 로직
- `src/lib/services/UnifiedChunkingService.ts`: 통합 청킹 서비스
- `src/lib/services/TextChunkingService.ts`: 텍스트 청킹 서비스
- `src/app/api/chat/route.ts`: 채팅 API 및 프롬프트 생성
- `src/app/api/admin/save-crawled-content/route.ts`: URL 크롤링 결과 저장
- `src/app/api/admin/upload-new/route.ts`: 문서 업로드

### 개선 후 구조 (예상)
- `src/lib/services/chunking/`: 문서 타입별 청킹 전략
- `src/lib/services/prompting/`: 프롬프트 빌더 및 컴포넌트
- `src/lib/services/embedding/`: 임베딩 모델 관리
- `src/lib/services/search/`: 검색 결과 필터링 및 재랭킹

