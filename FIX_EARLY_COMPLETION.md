# 작업 조기 완료 문제 해결 방안

## 문제 상황

**작업 ID**: `b379f7bf-e11b-4518-82a5-4cbe5595aaaf`
- **작업 종료**: `2025-12-05 02:21:48.611+00`
- **문서 생성**: `2025-12-05 02:21:49.195+00` ~ `02:21:49.744+00` (작업 종료 **이후**)

작업이 완료 처리된 후에도 문서가 생성되고 있어, 작업 완료 로직이 모든 문서 생성을 기다리지 않고 완료 처리하는 것으로 보입니다.

## 원인 분석

### 가능한 원인

1. **타임아웃으로 인한 조기 종료**
   - `Promise.race([ragPromise, ragTimeoutPromise])`에서 타임아웃이 먼저 발생
   - RAG 처리는 계속 진행되지만, 작업은 완료 처리됨

2. **비동기 작업의 지연**
   - `upsertAndProcessDocument` 내부의 DB 저장이 완료되기 전에 작업이 완료 처리됨
   - Supabase 트랜잭션 지연

3. **배치 처리 완료 후 추가 작업**
   - 모든 배치가 완료되었지만, 일부 문서 생성이 지연됨

## 해결 방안

### 방안 1: 작업 완료 전 문서 생성 확인

작업을 `completed`로 표시하기 전에, 모든 하위 페이지 문서가 실제로 생성되었는지 확인:

```typescript
// 모든 배치 완료 후
// 작업 완료 전에 실제 문서 생성 확인
const { data: createdDocs } = await supabase
  .from('documents')
  .select('id, url, status, chunk_count')
  .eq('main_document_id', documentId)
  .in('status', ['processing', 'indexing', 'indexed']);

// 모든 문서가 indexed 상태가 될 때까지 대기 (최대 30초)
const maxWaitTime = 30000; // 30초
const checkInterval = 1000; // 1초마다 확인
let waited = 0;

while (waited < maxWaitTime) {
  const { data: pendingDocs } = await supabase
    .from('documents')
    .select('id, status')
    .eq('main_document_id', documentId)
    .in('status', ['processing', 'indexing']);
  
  if (!pendingDocs || pendingDocs.length === 0) {
    break; // 모든 문서가 처리 완료
  }
  
  await new Promise(resolve => setTimeout(resolve, checkInterval));
  waited += checkInterval;
}
```

### 방안 2: 작업 완료 시점 조정

작업 완료를 표시하기 전에 최소 대기 시간 추가:

```typescript
// 모든 배치 완료 후
// 최소 2초 대기 (DB 트랜잭션 완료 대기)
await new Promise(resolve => setTimeout(resolve, 2000));

// 그 후 작업 완료 처리
```

### 방안 3: 문서 생성 완료 플래그 사용

각 배치에서 문서 생성이 완료되었는지 명시적으로 확인:

```typescript
// 배치 처리 완료 후
const batchDocIds = batchResults
  .filter(r => r.status === 'fulfilled' && r.value?.documentId)
  .map(r => r.value.documentId);

// 모든 문서가 실제로 DB에 생성되었는지 확인
const { data: verifiedDocs } = await supabase
  .from('documents')
  .select('id')
  .in('id', batchDocIds);

if (verifiedDocs.length !== batchDocIds.length) {
  console.warn('일부 문서가 아직 생성되지 않았습니다. 대기 중...');
  // 추가 대기 또는 재시도
}
```

## 권장 해결책

**방안 1 + 방안 2 조합**:
1. 모든 배치 완료 후 최소 2초 대기
2. 그 후 실제 문서 생성 확인
3. 모든 문서가 처리 완료될 때까지 최대 30초 대기
4. 그 후 작업 완료 처리

이렇게 하면 작업 완료 시점과 문서 생성 시점의 불일치를 해결할 수 있습니다.



