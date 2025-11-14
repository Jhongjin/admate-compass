# 문서 업로드 및 청크 임베딩 전체 파이프라인 상세 분석 보고서

## 📊 실행 요약

문서 업로드부터 청크 임베딩까지 전체 파이프라인을 처음부터 끝까지 단계별로 분석한 결과입니다.

---

## 🔄 전체 플로우 다이어그램

```
[클라이언트] NewDocumentUpload.tsx
    ↓
1. 파일 선택 (File 객체)
    ↓
2. Base64 인코딩 (file.text() → btoa) ⚠️ 문제점 1
    ↓
3. JSON 요청 전송 (/api/admin/upload-new)
    ↓
[서버] upload-new/route.ts
    ↓
4. 파일 타입별 처리
   ├─ PDF (10MB+): 큐 오프로딩
   ├─ PDF (<10MB): 텍스트 추출 시도 → 실패 시 BINARY_DATA
   ├─ DOCX (5MB+): 큐 오프로딩
   ├─ DOCX (<5MB): extract-docx API 호출 → 실패 시 큐 오프로딩
   └─ TXT: 직접 처리
    ↓
5. RAG 처리 시작 (ragProcessor.processDocument)
    ↓
[RAGProcessor] processDocument
    ↓
6. 타임아웃 설정 (AbortController) ⚠️ 문제점 2
    ↓
7. processDocumentInternal 호출
    ↓
8. 중복 검사 (skipDuplicate=false)
    ↓
9. BINARY_DATA 체크 → 청킹 건너뛰기 ⚠️ 문제점 3
    ↓
10. 텍스트 인코딩 처리 (processTextEncoding)
    ↓
11. 통합 청킹 서비스 (UnifiedChunkingService)
    ↓
12. AdaptiveChunkingService → 청크 생성
    ↓
13. 강제 재청킹 (1개 청크만 생성된 경우)
    ↓
14. 임베딩 생성 (generateEmbeddings)
   ├─ 작은 청크(100자 이하): 해시 기반 즉시 처리
   └─ 큰 청크: BGE-M3 배치 처리 (25개씩, 병렬)
    ↓
15. 문서 저장 (saveDocumentToDatabase)
    ↓
16. 청크 저장 (saveChunksToDatabase)
   ├─ 작은 파일: 한 번에 저장
   └─ 큰 파일: 배치 저장 (150-200개씩)
    ↓
17. 문서 상태 업데이트 (status: 'indexed', chunk_count)
    ↓
18. 완료 응답 반환
```

---

## 🔴 Critical 문제점

### 1. **클라이언트 측 Base64 인코딩 오류 - PDF/DOCX 파일 깨짐**

**위치**: `src/components/admin/NewDocumentUpload.tsx:340-341`

**문제점**:
```typescript
// 현재 코드
const fileContent = await file.text(); // ⚠️ PDF/DOCX는 바이너리 파일!
const base64Content = btoa(unescape(encodeURIComponent(fileContent)));
```

- `file.text()`는 텍스트 파일에만 작동합니다
- PDF/DOCX는 바이너리 파일이므로 `file.text()`로 읽으면 **데이터가 깨집니다**
- 깨진 데이터를 Base64로 인코딩하면 서버에서 처리할 수 없습니다

**영향**:
- PDF/DOCX 파일 업로드 시 텍스트 추출 실패
- BINARY_DATA로 저장되어 청킹 불가
- AI 검색 불가능

**해결 방법**:
```typescript
// 수정 필요
const arrayBuffer = await file.arrayBuffer();
const base64Content = Buffer.from(arrayBuffer).toString('base64');
```

---

### 2. **AbortSignal 미사용 - 타임아웃 시 작업이 중단되지 않음**

**위치**: `src/lib/services/RAGProcessor.ts:941`

**문제점**:
```typescript
private async processDocumentInternal(
  document: DocumentData, 
  skipDuplicate: boolean = false, 
  originalBinaryData?: string, 
  abortSignal?: AbortSignal  // ⚠️ 받지만 사용하지 않음!
): Promise<{...}>
```

- `abortSignal`을 파라미터로 받지만 실제로 사용하지 않음
- 타임아웃이 발생해도 청킹, 임베딩, 저장 작업이 계속 실행됨
- 리소스 낭비 및 메모리 누수

**영향**:
- 타임아웃 후에도 백그라운드에서 계속 실행
- 메모리 및 CPU 리소스 낭비
- 동시 처리 시 전체 시스템 성능 저하

**해결 방법**:
- 청킹, 임베딩, 저장 단계마다 `abortSignal.aborted` 체크
- 중단 시 즉시 에러 throw

---

### 3. **BINARY_DATA 처리 시 청킹 건너뛰기 - AI 검색 불가능**

**위치**: `src/lib/services/RAGProcessor.ts:977-1017`

**문제점**:
```typescript
if (document.content && document.content.startsWith('BINARY_DATA:')) {
  console.log('⚠️ PDF 바이너리 데이터 감지 - 청킹 건너뛰기, 문서만 저장');
  // 청킹 건너뛰고 문서만 저장
  return {
    documentId: document.id,
    chunkCount: 0,
    success: true, // ⚠️ success=true지만 chunk_count=0
  };
}
```

- PDF/DOCX 텍스트 추출 실패 시 BINARY_DATA로 저장
- 청킹이 건너뛰어져 `chunk_count=0`
- 문서는 저장되지만 **AI 검색이 불가능**
- 사용자는 "처리 완료"로 보이지만 실제로는 검색 불가

**영향**:
- 문서가 업로드되었지만 AI 검색에서 사용 불가
- 사용자 혼란 (왜 검색이 안 되지?)
- 데이터베이스에 불완전한 데이터 저장

**해결 방법**:
- 텍스트 추출 실패 시 명확한 에러 메시지 반환
- 또는 텍스트 추출 재시도 로직 추가

---

### 4. **임베딩 생성 실패 시 에러 전파 부족**

**위치**: `src/lib/services/RAGProcessor.ts:304-310`

**문제점**:
```typescript
} catch (error) {
  console.warn(`⚠️ 청크 BGE-M3 임베딩 생성 실패, 해시 기반으로 fallback:`, error);
  return {
    ...chunk,
    embedding: this.generateSimpleEmbedding(chunk.content), // ⚠️ 조용히 fallback
  };
}
```

- 임베딩 생성 실패 시 조용히 해시 기반으로 fallback
- 실패 원인을 기록하지 않음
- 사용자에게 알림이 없음
- 부분 실패가 누적되어 최종적으로 타임아웃 발생 가능

**영향**:
- 임베딩 품질 저하 (해시 기반은 의미 검색에 부적합)
- 실패 원인 추적 불가
- 사용자는 품질 저하를 인지하지 못함

---

### 5. **청크 저장 실패 시 부분 저장 문제**

**위치**: `src/lib/services/RAGProcessor.ts:1389-1396`

**문제점**:
```typescript
} catch (error) {
  console.error('❌ 데이터베이스 저장 실패:', error);
  // ⚠️ 에러를 catch하지만 처리하지 않음
  // 이미 저장된 청크는 그대로 남아있음
}
```

- 청크 저장 중 일부만 실패해도 전체가 실패로 처리되지 않음
- 부분 저장된 청크가 남아있어 데이터 일관성 문제
- `chunk_count`와 실제 저장된 청크 수 불일치

**영향**:
- 문서가 부분적으로만 인덱싱됨
- 검색 결과가 불완전할 수 있음
- 데이터 일관성 문제

---

## 🟡 Major 문제점

### 6. **청킹 결과가 비어있는 경우 처리 부족**

**위치**: `src/lib/services/RAGProcessor.ts:1300-1315`

**문제점**:
- 청킹 결과가 비어있으면 에러 반환하지만, 원인 분석이 부족
- 텍스트 인코딩 문제인지, 청킹 로직 문제인지 불명확

**영향**:
- 디버깅이 어려움
- 사용자는 "청킹 결과가 비어있습니다"라는 모호한 메시지만 받음

---

### 7. **임베딩 서비스 초기화 실패 시 재시도 없음**

**위치**: `src/lib/services/RAGProcessor.ts:74-95`

**문제점**:
- BGE-M3 모델 초기화 실패 시 해시 기반으로 fallback
- 재시도 로직이 없어 일시적 네트워크 문제도 영구 실패로 처리

**영향**:
- 일시적 문제도 영구 실패로 처리
- 임베딩 품질 저하

---

### 8. **큐 처리와 직접 처리의 불일치**

**위치**: 
- `src/app/api/admin/upload-new/route.ts` (직접 처리)
- `src/app/api/jobs/consume/route.ts` (큐 처리)

**문제점**:
- 같은 파일이라도 큐로 오프로딩되면 다른 처리 경로를 따름
- 큐 처리와 직접 처리의 로직이 일치하지 않을 수 있음

**영향**:
- 일관성 없는 처리 결과
- 디버깅 어려움

---

## 📈 해결 방안

### 우선순위 1: 클라이언트 측 Base64 인코딩 수정

**문제**: PDF/DOCX 파일을 `file.text()`로 읽어서 깨짐

**해결**:
```typescript
// NewDocumentUpload.tsx 수정
const arrayBuffer = await file.arrayBuffer();
const base64Content = Buffer.from(arrayBuffer).toString('base64');
```

---

### 우선순위 2: AbortSignal 실제 사용

**문제**: 타임아웃 시 작업이 중단되지 않음

**해결**:
- 청킹, 임베딩, 저장 단계마다 `abortSignal.aborted` 체크
- 중단 시 즉시 에러 throw

---

### 우선순위 3: BINARY_DATA 처리 개선

**문제**: BINARY_DATA로 저장되면 청킹이 건너뛰어져 AI 검색 불가

**해결**:
- 텍스트 추출 실패 시 명확한 에러 메시지 반환
- 또는 텍스트 추출 재시도 로직 추가
- 사용자에게 "텍스트 추출 실패" 알림

---

### 우선순위 4: 에러 전파 및 로깅 개선

**문제**: 임베딩 생성 실패, 청크 저장 실패 시 에러가 전파되지 않음

**해결**:
- 실패 원인을 명확히 기록
- 사용자에게 적절한 에러 메시지 전달
- 부분 실패 시 롤백 또는 재시도

---

## 🎯 예상 개선 효과

### 수정 전
- PDF/DOCX 파일: Base64 인코딩 오류 → 텍스트 추출 실패 → BINARY_DATA 저장 → AI 검색 불가
- 타임아웃: 작업이 중단되지 않아 리소스 낭비
- 에러 처리: 모호한 에러 메시지, 디버깅 어려움

### 수정 후
- PDF/DOCX 파일: 올바른 Base64 인코딩 → 텍스트 추출 성공 → 정상 청킹 → AI 검색 가능
- 타임아웃: 작업이 즉시 중단되어 리소스 효율성 향상
- 에러 처리: 명확한 에러 메시지, 디버깅 용이

---

## 📝 결론

문서 처리가 완료되지 않는 주요 원인:

1. **클라이언트 측 Base64 인코딩 오류** (가장 큰 문제)
   - PDF/DOCX를 `file.text()`로 읽어서 데이터 깨짐
   - 텍스트 추출 실패 → BINARY_DATA 저장 → 청킹 불가

2. **AbortSignal 미사용**
   - 타임아웃 시 작업이 중단되지 않아 리소스 낭비

3. **BINARY_DATA 처리 문제**
   - 청킹이 건너뛰어져 AI 검색 불가능

4. **에러 전파 부족**
   - 실패 원인을 사용자에게 전달하지 않음

이러한 문제점을 수정하면 **문서 처리 성공률이 크게 향상**될 것입니다.

