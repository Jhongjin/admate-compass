# 파일 처리 실패 원인 상세 분석 보고서

## 📊 실행 요약

파일 처리가 완료되지 않고 오래 지연되다가 실패하는 **명확한 원인**을 코드 레벨에서 분석한 결과입니다.

---

## 🔴 Critical 문제점 (즉시 수정 필요)

### 1. **타임아웃 불일치 - API 타임아웃이 RAG 처리 타임아웃보다 짧음**

**위치**: 
- `src/app/api/admin/upload-new/route.ts:14` - `maxDuration = 300` (5분)
- `src/lib/services/RAGProcessor.ts:894` - 대용량 파일: `480000ms` (8분)

**문제점**:
- **대용량 파일(10MB+)의 경우 RAGProcessor 타임아웃(8분)이 API 타임아웃(5분)보다 길어서 API가 먼저 타임아웃됨**
- API가 타임아웃되면 RAG 처리가 진행 중이어도 강제 종료됨
- 사용자는 "처리 중" 상태로 오래 기다리다가 실패 메시지를 받음

**현재 설정**:
```typescript
// upload-new/route.ts
export const maxDuration = 300; // 5분

// RAGProcessor.ts
const timeoutMs = isLargeFile ? 480000 : 120000; // 대용량: 8분, 일반: 2분
```

**영향**:
- 대용량 파일(10MB+): API가 5분에 타임아웃되지만 RAG 처리는 8분이 필요
- 결과: **처리 중단 및 실패**

---

### 2. **에러 메시지 누락 - 타임아웃 에러가 사용자에게 전달되지 않음**

**위치**: `src/lib/services/RAGProcessor.ts:915-922`

**문제점**:
- 타임아웃 에러를 catch하지만 `error` 필드를 반환하지 않음
- `upload-new/route.ts`에서 `ragResult.success`가 false인 경우 에러 메시지가 없음
- 사용자는 "문서 처리 중 오류가 발생했습니다."라는 모호한 메시지만 받음

**현재 코드**:
```typescript
} catch (error) {
  console.error('❌ RAG 문서 처리 실패:', error);
  return {
    documentId: document.id,
    chunkCount: 0,
    success: false,
    // ❌ error 필드가 없음!
  };
}
```

**영향**:
- 사용자가 실패 원인을 알 수 없음
- 디버깅이 어려움

---

### 3. **Promise.race의 리소스 누수 문제**

**위치**: `src/lib/services/RAGProcessor.ts:902-913`

**문제점**:
- `Promise.race`를 사용하면 타임아웃이 발생해도 `processDocumentInternal`이 계속 실행될 수 있음
- 메모리 및 CPU 리소스 낭비
- 동시에 여러 파일을 처리할 때 리소스 부족으로 전체 시스템이 느려질 수 있음

**현재 코드**:
```typescript
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => {
    reject(new Error(`문서 처리 타임아웃 (${timeoutMs}ms 초과)`));
  }, timeoutMs);
});

const processPromise = this.processDocumentInternal(document, skipDuplicate, originalBinaryData);

// 타임아웃이 발생해도 processPromise는 계속 실행됨
const result = await Promise.race([processPromise, timeoutPromise]);
```

**영향**:
- 타임아웃 후에도 백그라운드에서 계속 실행되어 리소스 낭비
- 메모리 누수 가능성

---

### 4. **임베딩 생성 실패 시 에러 전파 부족**

**위치**: `src/lib/services/RAGProcessor.ts:229-335`

**문제점**:
- 임베딩 생성 실패 시 해시 기반으로 fallback하지만, 실패 원인을 기록하지 않음
- 일부 청크만 실패한 경우 전체가 실패로 처리되지 않음
- 부분 실패가 누적되어 최종적으로 타임아웃 발생 가능

**영향**:
- 임베딩 생성이 느리거나 실패해도 사용자에게 알림이 없음
- 처리 시간이 예상보다 길어져 타임아웃 발생

---

## 🟡 Major 문제점

### 5. **큐 처리 타임아웃과 재시도 로직의 문제**

**위치**: `src/app/api/jobs/consume/route.ts:1133-1210`

**문제점**:
- 큐 처리 타임아웃(8분)이 발생하면 재시도하지만, 재시도도 같은 타임아웃으로 실패할 가능성이 높음
- 최대 3번 재시도하면 총 24분(8분 × 3) 소요 가능
- 사용자는 이 시간 동안 "처리 중" 상태로 대기

**영향**:
- 사용자 경험 저하
- 불필요한 재시도로 인한 리소스 낭비

---

### 6. **청크 저장 실패 시 부분 저장 문제**

**위치**: `src/lib/services/RAGProcessor.ts:1326-1372`

**문제점**:
- 청크 저장 중 일부만 실패해도 전체가 실패로 처리되지 않음
- 부분 저장된 청크가 남아있어 데이터 일관성 문제 발생 가능

**영향**:
- 문서가 부분적으로만 인덱싱됨
- 검색 결과가 불완전할 수 있음

---

## 📈 해결 방안

### 우선순위 1: 타임아웃 불일치 수정

1. **API 타임아웃을 RAG 처리 타임아웃보다 길게 설정**
   - `upload-new/route.ts`: `maxDuration = 600` (10분)
   - `vercel.json`: `maxDuration = 600` (10분)
   - RAGProcessor 타임아웃: 대용량 8분 유지

2. **타임아웃 에러 메시지 개선**
   - 타임아웃 발생 시 명확한 에러 메시지 반환
   - 파일 크기와 예상 처리 시간 정보 포함

---

### 우선순위 2: 에러 처리 개선

1. **에러 메시지 전파**
   - `processDocument`에서 에러 메시지를 반환하도록 수정
   - 사용자에게 명확한 실패 원인 제공

2. **Promise.race 개선**
   - AbortController를 사용하여 타임아웃 시 실제로 작업 중단
   - 리소스 누수 방지

---

### 우선순위 3: 부분 실패 처리

1. **임베딩 생성 실패 추적**
   - 실패한 청크 개수 기록
   - 부분 실패 시 경고 메시지 제공

2. **청크 저장 일관성 보장**
   - 트랜잭션 사용 또는 롤백 로직 추가
   - 부분 저장 방지

---

## 🎯 예상 개선 효과

### 수정 전
- 대용량 파일: API 타임아웃(5분) → 처리 실패
- 에러 메시지: "문서 처리 중 오류가 발생했습니다." (모호함)
- 리소스 누수: 타임아웃 후에도 백그라운드 실행

### 수정 후
- 대용량 파일: API 타임아웃(10분) → 처리 완료 가능
- 에러 메시지: "문서 처리 타임아웃 (8분 초과) - 파일 크기: 12MB" (명확함)
- 리소스 관리: 타임아웃 시 즉시 중단

---

## 📝 결론

파일 처리 실패의 주요 원인:

1. **타임아웃 불일치** (가장 큰 문제)
   - API 타임아웃(5분) < RAG 처리 타임아웃(8분)
   - 대용량 파일 처리 시 API가 먼저 타임아웃

2. **에러 메시지 누락**
   - 타임아웃 에러가 사용자에게 전달되지 않음
   - 디버깅이 어려움

3. **리소스 누수**
   - Promise.race로 인한 백그라운드 실행 지속

이러한 문제점을 수정하면 **대용량 파일 처리 성공률이 크게 향상**될 것입니다.


