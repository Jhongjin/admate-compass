# 파일 업로드 및 처리 성능 분석 보고서

## 📊 개요

파일 업로드 및 처리 로딩이 오래 걸리는 원인을 분석한 결과입니다.

## 🔍 주요 병목 지점

### 1. **임베딩 생성 병목 (가장 큰 문제)**

**위치**: `src/lib/services/RAGProcessor.ts:229-291`

**문제점**:
- 배치 크기 10개로 제한되어 있지만, 각 청크마다 **순차적으로** 임베딩 생성
- BGE-M3 모델 초기화가 첫 실행 시 매우 느림 (모델 다운로드 + 로딩)
- 청크가 많을수록 처리 시간이 선형적으로 증가

**현재 처리 방식**:
```typescript
// 배치 처리 (한 번에 너무 많이 처리하지 않도록)
const BATCH_SIZE = 10;
for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
  const batch = chunks.slice(i, i + BATCH_SIZE);
  // 각 청크를 순차적으로 처리
  const batchPromises = batch.map(async (chunk) => {
    const result = await embeddingService.generateEmbedding(chunk.content);
    // ...
  });
  await Promise.all(batchPromises); // 배치 내에서는 병렬 처리
}
```

**예상 소요 시간**:
- 청크 1개당 임베딩 생성: 약 0.5-2초
- 청크 100개: 약 50-200초 (1-3분)
- 청크 500개: 약 250-1000초 (4-16분)

### 2. **PDF 텍스트 추출 병목**

**위치**: `src/app/api/admin/upload-new/route.ts:574-616`

**문제점**:
- PDF 파싱이 동기적으로 처리됨
- 타임아웃이 60초로 설정되어 있지만, 대용량 PDF는 여전히 느림
- `pdf-parse` 라이브러리가 메모리 집약적

**현재 처리 방식**:
```typescript
const pdfPromise = (async () => {
  const pdf = (await import('pdf-parse')).default;
  return await pdf(fileBuffer);
})();

const timeoutPromise = new Promise((_, reject) => 
  setTimeout(() => reject(new Error('PDF extraction timeout')), 60000)
);

const pdfData = await Promise.race([pdfPromise, timeoutPromise]);
```

**예상 소요 시간**:
- 작은 PDF (1-5MB): 약 5-15초
- 중간 PDF (5-10MB): 약 15-40초
- 큰 PDF (10MB+): 큐로 오프로딩되지만, 큐 처리도 느림

### 3. **DOCX 파일 큐 오프로딩 지연**

**위치**: `src/app/api/admin/upload-new/route.ts:634-650`

**문제점**:
- **모든 DOCX 파일**이 큐로 오프로딩됨 (크기 무관)
- 큐 워커가 즉시 실행되지 않을 수 있음
- 큐 처리 자체가 느림 (텍스트 추출 + 청킹 + 임베딩)

**현재 처리 방식**:
```typescript
// DOCX 파일은 모든 크기에 대해 큐로 처리
const documentId = `doc_${Date.now()}`;
const storageInfo = await uploadToStorage(file, documentId, cleanFileName);
const jobId = await enqueueProcessingJob({
  documentId,
  jobType: 'DOCX_PARSE',
  priority: 7,
  payload: { fileName: cleanFileName, fileSize: file.size, fileType: file.type, storage: storageInfo }
});

triggerQueueWorker(); // 즉시 트리거 시도
return NextResponse.json({ success: true, queued: true, jobId, documentId }, { status: 202 });
```

**예상 소요 시간**:
- 큐 등록: 즉시
- 큐 워커 실행: 1-60초 (Cron Job에 의존)
- 큐 처리: 파일 크기에 따라 1-10분

### 4. **큐 폴링 지연**

**위치**: `src/app/admin/docs/page.tsx:710-1243`

**문제점**:
- 5초마다 폴링하여 큐 상태 확인
- 큐 처리 시간이 길면 사용자는 오래 기다려야 함
- 최대 10분(120회 폴링)까지 대기

**현재 처리 방식**:
```typescript
const poll = async () => {
  // 5초마다 큐 상태 확인
  const { data: job } = await supabaseClient
    .from('processing_jobs')
    .select('status, error, finished_at')
    .eq('id', jobId)
    .single();
  
  if (job.status === 'completed') {
    // 완료 처리
  } else if (job.status === 'failed') {
    // 실패 처리
  } else {
    // 5초 후 다시 폴링
    pollTimeout = setTimeout(poll, 5000);
  }
};
```

**예상 소요 시간**:
- 큐 처리 완료까지: 파일 크기와 청크 수에 따라 1-10분
- 폴링 간격: 5초
- 최대 대기 시간: 10분

### 5. **청크 저장 병목**

**위치**: `src/lib/services/RAGProcessor.ts:537-650`

**문제점**:
- 청크가 많을 경우 배치 저장하지만, 여전히 순차적으로 처리
- 각 배치마다 DB 쿼리 실행
- 임베딩 벡터 저장이 느림 (1024차원)

**현재 처리 방식**:
```typescript
if (isLargeBatch) {
  const batchSize = 50;
  for (let i = 0; i < chunkInserts.length; i += batchSize) {
    const batch = chunkInserts.slice(i, i + batchSize);
    const { error } = await supabase
      .from('document_chunks')
      .insert(batch);
    // 배치마다 대기
  }
}
```

**예상 소요 시간**:
- 청크 100개 저장: 약 5-15초
- 청크 500개 저장: 약 25-75초

### 6. **순차적 파일 처리**

**위치**: `src/app/admin/docs/page.tsx:1304-1343`

**문제점**:
- 여러 파일을 업로드할 때 **순차적으로** 처리
- 첫 번째 파일 처리가 완료되어야 두 번째 파일 처리 시작

**현재 처리 방식**:
```typescript
for (let i = 0; i < filesToUpload.length; i++) {
  const uploadFile = filesToUpload[i];
  await uploadSingleFile(uploadFile, i, filesToUpload.length);
  // 다음 파일로 진행
}
```

**예상 소요 시간**:
- 파일 3개 업로드 시: 각 파일 처리 시간의 합계
- 예: 파일당 2분씩 → 총 6분

## 📈 성능 개선 권장사항

### 우선순위 1: 임베딩 생성 최적화

1. **배치 크기 증가**: 10개 → 20-30개
2. **병렬 처리 개선**: 배치 간 병렬 처리 고려
3. **임베딩 모델 캐싱**: 모델 초기화 결과 재사용
4. **작은 청크는 해시 기반 임베딩 사용**: 100자 이하 청크는 해시 기반으로 빠르게 처리

### 우선순위 2: 큐 처리 최적화

1. **큐 워커 즉시 실행 보장**: 큐 등록 후 즉시 워커 트리거
2. **큐 처리 상태 실시간 업데이트**: WebSocket 또는 Server-Sent Events 사용
3. **큐 처리 진행률 표시**: 단계별 진행률 표시 (텍스트 추출 30%, 청킹 50%, 임베딩 80%, 저장 100%)

### 우선순위 3: 파일 처리 최적화

1. **작은 DOCX 파일 즉시 처리**: 5MB 이하 DOCX는 큐 없이 즉시 처리
2. **PDF 텍스트 추출 최적화**: 페이지 수 제한 또는 부분 추출
3. **병렬 파일 처리**: 여러 파일을 동시에 처리 (제한: 2-3개 동시)

### 우선순위 4: 사용자 경험 개선

1. **진행률 표시 개선**: 단계별 상세 진행률 표시
2. **예상 소요 시간 표시**: 파일 크기 기반 예상 시간 계산
3. **백그라운드 처리 알림**: 큐 처리 시 "백그라운드에서 처리 중" 알림

## 🔧 즉시 적용 가능한 개선사항

### 1. 임베딩 배치 크기 증가

```typescript
// 현재: BATCH_SIZE = 10
// 개선: BATCH_SIZE = 20-30
const BATCH_SIZE = 25; // 청크당 평균 1초 가정 시, 25초 내 처리
```

### 2. 작은 DOCX 파일 즉시 처리

```typescript
// DOCX 파일 크기 체크
if (file.size <= 5 * 1024 * 1024) {
  // 5MB 이하는 즉시 처리
  // 기존 TXT 처리 로직과 유사하게 처리
} else {
  // 5MB 초과는 큐로 오프로딩
}
```

### 3. 폴링 간격 조정

```typescript
// 현재: 5초마다 폴링
// 개선: 초기에는 2초, 이후 5초로 점진적 증가
let pollInterval = 2000; // 초기 2초
const poll = async () => {
  // ... 상태 확인
  if (job.status === 'processing') {
    pollInterval = Math.min(pollInterval + 1000, 5000); // 최대 5초
    pollTimeout = setTimeout(poll, pollInterval);
  }
};
```

### 4. 진행률 표시 개선

```typescript
// 단계별 진행률 계산
const progress = {
  uploading: 10,
  extracting: 30,
  chunking: 50,
  embedding: 80,
  saving: 100
};
```

## 📊 예상 성능 개선 효과

| 개선사항 | 현재 | 개선 후 | 개선율 |
|---------|------|---------|--------|
| 임베딩 생성 (100청크) | 50-200초 | 20-80초 | 60% 개선 |
| 작은 DOCX 처리 | 큐 대기 + 처리 | 즉시 처리 | 즉시 응답 |
| 폴링 지연 | 5초 고정 | 2-5초 적응형 | 40% 개선 |
| 병렬 파일 처리 | 순차 처리 | 2-3개 동시 | 50-66% 개선 |

## 🎯 결론

가장 큰 병목은 **임베딩 생성**입니다. 청크가 많을수록 처리 시간이 선형적으로 증가합니다. 

**즉시 적용 가능한 개선**:
1. 임베딩 배치 크기 증가 (10 → 25)
2. 작은 DOCX 파일 즉시 처리 (5MB 이하)
3. 폴링 간격 최적화 (2-5초 적응형)

**중장기 개선**:
1. 임베딩 모델 최적화 (더 빠른 모델 또는 하드웨어 가속)
2. 큐 처리 실시간 업데이트 (WebSocket)
3. 병렬 파일 처리 구현


