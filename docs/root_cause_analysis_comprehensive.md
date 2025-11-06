# 근본 원인 분석 보고서

**문제**: 
1. DOCX 파일 청크 0개
2. 13MB 파일 타임아웃 (10분)

---

## 🔍 전체 플로우 분석

### 플로우 1: 파일 업로드 → 큐 등록

```
1. 파일 업로드 (upload-new/route.ts)
   ↓
2. Storage에 파일 저장
   ↓
3. documents 테이블에 레코드 생성 (status: 'pending', chunk_count: 0)
   ↓
4. processing_jobs 테이블에 job 등록 (PDF_PARSE 또는 DOCX_PARSE)
```

**문제 지점**: 없음 (정상)

---

### 플로우 2: 큐 처리 → 텍스트 추출

```
1. processing_jobs에서 queued job 선택
   ↓
2. Storage에서 파일 다운로드
   ↓
3. PDF/DOCX 파싱
   - PDF: processPdfBuffer()
   - DOCX: processDocxBuffer()
   ↓
4. 텍스트 추출 검증
   - cleanedLength < 500 → OCR 폴백 (PDF만)
   ↓
5. 텍스트 정규화
```

**문제 지점 후보**:

#### ❌ 문제 1: DOCX 텍스트 추출 실패
**위치**: `processDocxBuffer()` (line 79-117)
- `mammoth.extractRawText()` 실패 시 빈 문자열 반환
- 빈 텍스트 체크 후 빈 문자열 반환 (line 93)
- **원인**: 
  - DOCX 파일이 손상되었거나
  - mammoth 라이브러리 이슈
  - 또는 텍스트가 실제로 없음

**확인 필요**:
```typescript
// 현재 코드
if (!extractedText || extractedText.trim().length === 0) {
  console.warn('⚠️ DOCX에서 텍스트를 추출할 수 없습니다. 빈 텍스트 반환');
  return ''; // ❌ 빈 문자열 반환 → 청킹 불가
}
```

**문제**: 빈 텍스트를 반환하면 이후 청킹 단계에서 청크가 0개가 됨

---

#### ❌ 문제 2: 텍스트 추출 후 검증 로직 누락
**위치**: `processDocxBuffer()` 이후 (line 481-488)
- 텍스트 추출 후 `cleanedLength` 검증
- 하지만 **빈 텍스트에 대한 에러 처리 없음**
- DOCX의 경우 OCR 폴백 없음 (line 492)

**문제**: 
- DOCX에서 텍스트가 추출되지 않아도 처리가 계속 진행됨
- 빈 텍스트로 청킹 시도 → 청크 0개 생성 → `indexed` 상태로 마킹

---

### 플로우 3: 텍스트 추출 → 분할 감지

```
1. normalizedText 생성
   ↓
2. 큰 파일 감지
   - fileSize > 10MB OR normalizedText.length > 500KB
   ↓
3. 분할 처리 (큰 파일인 경우)
   - simpleTextSplitter.splitByFixedSize()
   - document_splits 테이블에 저장
   - CHUNK_PROCESS job 등록
   ↓
4. 일반 처리 (작은 파일인 경우)
   - ragProcessor.processDocument()
```

**문제 지점**:

#### ❌ 문제 3: 13MB 파일 분할 처리 전 타임아웃
**위치**: 텍스트 추출 → 분할 감지 사이

**타임아웃 발생 시나리오**:
1. 파일 다운로드: 1-2초
2. PDF 파싱: **5-8분** (13MB PDF)
3. 텍스트 정규화: 1-2초
4. **이미 여기서 8분 경과** → 분할 감지 전에 타임아웃

**확인**: `MAX_PROCESS_TIME = 480000` (8분)은 **전체 처리 시간**이므로, PDF 파싱만으로도 타임아웃 가능

---

### 플로우 4: 청킹 → 임베딩 → 저장

```
1. 청킹 (simpleChunkDocument)
   ↓
2. 임베딩 생성 (배치 처리)
   ↓
3. DB 저장 (배치 처리)
   ↓
4. documents.chunk_count 업데이트
```

**문제 지점**:

#### ❌ 문제 4: DOCX 빈 텍스트 청킹
**위치**: `simpleChunkDocument()` (line 971-1019)
- 빈 텍스트 체크 후 빈 배열 반환 (line 977)
- **하지만 빈 텍스트가 들어오면 청크 0개 반환**

**확인 필요**:
```typescript
// 현재 코드
if (!document.content || document.content.trim() === '') {
  console.warn('⚠️ 문서 내용이 비어있습니다.');
  return []; // ❌ 빈 배열 반환 → chunk_count: 0
}
```

**문제**: 
- 빈 텍스트로 청킹 시도 → 빈 배열 반환
- `saveChunksToDatabase([])` 호출 → 청크 0개 저장
- `chunk_count: 0`으로 업데이트
- 하지만 `status: 'indexed'`로 설정됨 (line 826-849)

---

#### ❌ 문제 5: 청크 0개인데 indexed 상태
**위치**: `processQueue()` (line 826-849)
- `processResult.success`가 true면 `status: 'indexed'` 설정
- 하지만 `chunkCount: 0`인 경우도 `indexed`로 설정됨

**확인 필요**:
```typescript
// 현재 코드
.update({ 
  status: processResult.success ? 'indexed' : 'failed', 
  chunk_count: finalChunkCount, // 0일 수 있음
})
```

**문제**: 
- 청크 0개인데 `indexed` 상태로 표시
- 사용자는 문서가 완료된 것으로 오인

---

## 🔧 근본 원인 요약

### DOCX 파일 청크 0 문제

**근본 원인 1**: 텍스트 추출 실패 시 빈 문자열 반환
- `processDocxBuffer()`에서 텍스트 추출 실패 시 빈 문자열 반환
- 이후 청킹 단계에서 빈 배열 반환
- 청크 저장 시 0개 저장
- 하지만 `status: 'indexed'`로 설정됨

**근본 원인 2**: 텍스트 추출 실패에 대한 에러 처리 부족
- DOCX 텍스트 추출 실패 시 에러를 throw하지 않음
- 빈 텍스트로 처리를 계속 진행
- 결과적으로 청크 0개인데 `indexed` 상태

**근본 원인 3**: 청크 0개인데 indexed 상태로 설정
- `chunkCount: 0`인 경우도 `indexed` 상태로 설정
- 사용자에게 문서가 완료된 것으로 표시

---

### 13MB 파일 타임아웃 문제

**근본 원인 1**: PDF 파싱 시간이 너무 김
- 13MB PDF 파싱에 5-8분 소요
- `MAX_PROCESS_TIME = 8분`이므로 파싱만으로도 타임아웃 가능
- 분할 감지 전에 이미 타임아웃

**근본 원인 2**: 분할 조건이 너무 늦음
- 분할 조건: `fileSize > 10MB OR normalizedText.length > 500KB`
- 하지만 PDF 파싱은 **분할 전에** 실행됨
- 파싱 시간이 타임아웃을 초과하면 분할에 도달하지 못함

**근본 원인 3**: 타임아웃 설정이 부족
- `MAX_PROCESS_TIME = 8분` (480000ms)
- 하지만 PDF 파싱만으로도 5-8분 소요
- 분할 처리 시간을 고려하지 않음

---

## ✅ 해결 방안

### DOCX 파일 청크 0 문제 해결

#### 방안 1: 텍스트 추출 실패 시 에러 throw
```typescript
// processDocxBuffer() 수정
if (!extractedText || extractedText.trim().length === 0) {
  throw new Error('DOCX에서 텍스트를 추출할 수 없습니다. 파일이 손상되었거나 텍스트가 없습니다.');
}
```

#### 방안 2: 청크 0개인 경우 failed 상태로 설정
```typescript
// processQueue() 수정
.update({ 
  status: (processResult.success && finalChunkCount > 0) ? 'indexed' : 'failed', 
  chunk_count: finalChunkCount,
})
```

#### 방안 3: 빈 텍스트 검증 추가
```typescript
// 텍스트 추출 후 검증
if (cleanedLength === 0 && job.job_type === 'DOCX_PARSE') {
  throw new Error('DOCX에서 텍스트를 추출할 수 없습니다. 파일이 손상되었거나 텍스트가 없습니다.');
}
```

---

### 13MB 파일 타임아웃 문제 해결

#### 방안 1: PDF 파싱 타임아웃 설정
```typescript
// processPdfBuffer()에 타임아웃 추가
const PDF_PARSE_TIMEOUT = 300000; // 5분
const parsePromise = pdf(data, options);
const timeoutPromise = new Promise((_, reject) => 
  setTimeout(() => reject(new Error('PDF 파싱 타임아웃')), PDF_PARSE_TIMEOUT)
);
const pdfData = await Promise.race([parsePromise, timeoutPromise]);
```

#### 방안 2: 파일 크기 기반 분할 조건 사전 적용
```typescript
// 파일 크기만으로 분할 결정 (파싱 전)
if (fileSize > 10 * 1024 * 1024) {
  // 즉시 분할 처리로 전환 (파싱 전)
  // 파일을 여러 부분으로 나누어 파싱
}
```

#### 방안 3: MAX_PROCESS_TIME 증가
```typescript
// PDF 파싱 시간을 고려하여 증가
const MAX_PROCESS_TIME = 600000; // 10분 (PDF 파싱 5-8분 + 분할 처리 2-5분)
```

---

## 📋 우선순위별 수정 사항

### Critical (즉시 수정)

1. ✅ DOCX 텍스트 추출 실패 시 에러 throw
2. ✅ 청크 0개인 경우 failed 상태로 설정
3. ✅ 빈 텍스트 검증 추가

### High (빠른 수정)

4. ✅ PDF 파싱 타임아웃 설정
5. ✅ MAX_PROCESS_TIME 증가 (10분)

### Medium (장기 개선)

6. 파일 크기 기반 분할 조건 사전 적용
7. PDF 파싱 최적화 (스트리밍 파싱)

---

**다음 단계**: 위 수정 사항을 적용하여 문제 해결

