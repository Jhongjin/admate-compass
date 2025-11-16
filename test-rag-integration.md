# RAG 처리 통합 테스트 가이드

## 테스트 완료 항목

### 1. 문서 구조 분석 개선 테스트 ✅
- **결과**: 6/6 테스트 통과
- **개선 사항**:
  - 마크다운 제목 감지: ✅
  - 번호 제목 감지: ✅
  - 로마 숫자 제목 감지: ✅
  - 한글 제목 감지: ✅
  - 짧은 줄 제목 감지: ✅
  - 복합 구조 문서 감지: ✅

### 2. 변경사항 요약

**`src/lib/services/AdaptiveChunkingService.ts`**:
- `analyzeDocumentStructure` 메서드 개선
  - 제목 패턴 감지 확장 (7가지 패턴)
  - 줄바꿈 기반 짧은 줄 제목 감지 추가
  - 문단 구분 감지 개선 (정확한 위치 계산)

**`src/lib/services/RAGProcessor.ts`**:
- 동기 방식으로 복원 (2분 타임아웃)
- 모델 초기화 실패 시 해시 기반 임베딩으로 fallback

**`src/lib/services/EmbeddingService.ts`**:
- 동기 방식 유지
- 명확한 타임아웃 설정

## 다음 단계: 실제 문서 업로드 테스트

### 방법 1: 개발 서버 실행 후 UI에서 테스트
```bash
npm run dev
```
1. 브라우저에서 `/admin/docs` 페이지 접속
2. 테스트 문서 업로드
3. 로그에서 `sectionsCount`와 `paragraphsCount` 확인

### 방법 2: API 직접 테스트
```bash
# RAG 처리 테스트 API 호출
curl -X POST http://localhost:3000/api/test-rag
```

### 방법 3: 실제 문서 업로드 API 테스트
```bash
# Base64 인코딩된 텍스트 파일 업로드
curl -X POST http://localhost:3000/api/admin/upload-new \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "test.txt",
    "fileSize": 100,
    "fileType": "text/plain",
    "fileContent": "BASE64_ENCODED_CONTENT",
    "type": "file"
  }'
```

## 예상 결과

### 이전 (문제)
- `sectionsCount: 1`
- `paragraphsCount: 1`
- 문서 구조 분석 실패

### 개선 후 (예상)
- `sectionsCount: > 1` (문서 구조에 따라 다름)
- `paragraphsCount: > 1` (문서 구조에 따라 다름)
- 다양한 제목 패턴 감지
- 정확한 문단 구분

## 모니터링 포인트

1. **로그 확인**:
   - `[CRITICAL] 📊 문서 구조 분석 결과` 로그
   - `sectionsCount` 값
   - `paragraphsCount` 값

2. **청킹 결과**:
   - 생성된 청크 수
   - 청크 품질 (의미 단위 분할)

3. **성능**:
   - 문서 처리 시간
   - 임베딩 생성 시간

