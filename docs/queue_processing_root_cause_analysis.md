# 큐 처리 타임아웃 근본 원인 상세 분석

**작성일**: 2025-01-31  
**문제**: 큐 처리 시간 초과가 계속 반복됨 (10분 타임아웃)

---

## 🔍 발견된 핵심 문제점

### 1. ❌ 재시도 메커니즘이 작동하지 않음

**현상**:
- 시도 횟수: `0/3` (첫 시도에서 실패)
- 재시도 로직이 실행되지 않음

**원인 분석**:
```typescript
// 현재 코드: 타임아웃 발생 시 즉시 에러 throw
catch (timeoutError) {
  throw timeoutError; // 재시도 없이 즉시 실패 처리
}
```

**문제점**:
1. 타임아웃 발생 시 `attempts`가 증가하지 않음
2. `failed` 상태로 즉시 업데이트됨
3. 재시도 로직이 트리거되지 않음

---

### 2. ⚠️ Vercel Cron Job 실행 빈도 문제

**현재 설정**:
```json
{
  "path": "/api/jobs/consume",
  "schedule": "*/1 * * * *"  // 1분마다 실행
}
```

**문제점**:
- 하나의 작업이 10분 걸리면 다음 Cron 실행이 대기해야 함
- 동시에 여러 작업을 처리할 수 없음
- 큐가 쌓이면 처리 지연 발생

**실제 동작**:
1. Cron Job이 1분마다 실행
2. 첫 번째 작업 처리 시작 (10분 소요 예상)
3. 1분 후 다음 Cron 실행 → 이미 처리 중이므로 무시
4. 10분 후 타임아웃 → 실패 처리
5. 다음 Cron 실행 시 새로운 작업 처리

---

### 3. 🚨 Promise.race() 사용의 문제

**현재 코드**:
```typescript
const processPromise = ragProcessor.processDocument(docData, true);
const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(new Error('타임아웃')), MAX_PROCESS_TIME);
});

try {
  processResult = await Promise.race([processPromise, timeoutPromise]);
} catch (timeoutError) {
  throw timeoutError; // 타임아웃 시 즉시 종료
}
```

**문제점**:
1. 타임아웃이 발생해도 실제 처리는 백그라운드에서 계속 진행될 수 있음
2. 메모리 누수 가능성 (처리 중인 Promise가 종료되지 않음)
3. 타임아웃 후 실제 처리가 완료되어도 결과를 받지 못함

---

### 4. 💾 메모리 제한 문제

**Vercel Pro 플랜 제약**:
- 메모리: **1024MB** (1GB)
- CPU: 제한적 (서버리스 환경)

**PDF 파싱 메모리 사용**:
- `pdf-parse`는 전체 PDF를 메모리에 로드
- 13MB PDF → 메모리 사용량: 50-100MB
- 청킹 후 임베딩 생성: 청크 수 × 임베딩 벡터 크기
- 1000개 청크 × 1536차원 벡터 = 약 6MB
- **총 메모리 사용량: 100-200MB** (예상)

**문제점**:
- 큰 파일 처리 시 메모리 부족 가능성
- 가비지 컬렉션 지연으로 인한 성능 저하

---

### 5. ⏱️ 순차 처리로 인한 시간 누적

**처리 파이프라인**:
```
PDF 다운로드 → PDF 파싱 → 텍스트 정규화 → 청킹 → 임베딩 생성 → DB 저장
```

**예상 시간 (13MB PDF)**:
| 단계 | 예상 시간 | 누적 |
|------|----------|------|
| 다운로드 | 10-30초 | 0:30 |
| PDF 파싱 | 2-5분 | 3:30 |
| 정규화 | 5-10초 | 3:40 |
| 청킹 | 1-3분 | 6:40 |
| 임베딩 | 2-4분 | 10:40 |
| DB 저장 | 1-2분 | 12:40 |
| **총합** | **10-12분** | **타임아웃 초과!** |

**문제점**:
- 각 단계가 순차적으로 실행되어 시간 누적
- 병렬 처리 불가

---

### 6. 🔄 큐 처리 로직의 비효율성

**현재 로직**:
```typescript
// 한 번에 하나의 작업만 처리
const { data: job } = await supabase
  .from('processing_jobs')
  .select('...')
  .eq('status', 'queued')
  .limit(1)  // 하나만 처리
  .maybeSingle();
```

**문제점**:
1. 동시에 여러 작업을 처리할 수 없음
2. 큰 작업이 타임아웃되면 다른 작업도 대기
3. 큐가 쌓이면 처리 지연 증가

---

### 7. 📊 로깅 부족으로 인한 디버깅 어려움

**현재 상태**:
- 단계별 시간 측정은 추가됨
- 하지만 실제 어느 단계에서 시간이 오래 걸리는지 확인 어려움
- Vercel 로그에서 상세한 분석 어려움

---

## 💡 근본 원인 종합

### 주요 원인 (우선순위순)

1. **처리 시간이 실제 타임아웃보다 길음** (10분 < 12분)
   - 해결: 파일 분할 처리 또는 타임아웃 증가 (Enterprise 플랜 필요)

2. **재시도 메커니즘이 작동하지 않음**
   - 해결: 타임아웃 시 `attempts` 증가 및 재시도 로직 구현

3. **Promise.race() 사용으로 인한 메모리 누수 가능성**
   - 해결: 타임아웃 시 실제 처리를 중단하는 로직 추가

4. **순차 처리로 인한 시간 누적**
   - 해결: 가능한 단계는 병렬 처리

5. **큐 처리 로직의 비효율성**
   - 해결: 동시 처리 지원 또는 우선순위 기반 처리

---

## 🔧 즉시 적용 가능한 해결 방안

### 1. 재시도 메커니즘 수정

```typescript
// 타임아웃 발생 시 attempts 증가 및 재시도
catch (timeoutError) {
  const currentAttempts = job.attempts || 0;
  const maxAttempts = job.max_attempts || 3;
  
  if (currentAttempts < maxAttempts) {
    // 재시도 가능: retrying 상태로 변경
    await supabase
      .from('processing_jobs')
      .update({
        status: 'retrying',
        attempts: currentAttempts + 1,
        scheduled_at: new Date(Date.now() + 60000).toISOString() // 1분 후 재시도
      })
      .eq('id', job.id);
  } else {
    // 최대 시도 횟수 초과: failed 상태
    throw timeoutError;
  }
}
```

### 2. 타임아웃 시 실제 처리 중단

```typescript
let processingAborted = false;

const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => {
    processingAborted = true;
    reject(new Error('타임아웃'));
  }, MAX_PROCESS_TIME);
});

// processDocument 내부에서 processingAborted 체크
if (processingAborted) {
  throw new Error('처리 중단됨');
}
```

### 3. 파일 크기 제한 강화

- 현재: 20MB
- 권장: **15MB** (더 안정적인 처리)

### 4. 청크 크기 최적화

- 큰 파일은 더 큰 청크 사용 (청크 수 감소)
- 임베딩 생성 시간 단축

### 5. 배치 크기 조정

- 임베딩 배치: 100 → **150개** (처리 시간 단축)
- 저장 배치: 50 → **100개** (처리 시간 단축)

---

## 📋 중기 해결 방안

### 1. 파일 분할 처리 (권장)

- 페이지 단위 분할
- 병렬 처리
- 부분 완료 지원

### 2. Vercel Enterprise 플랜 검토

- 최대 실행 시간: 15분 (확인 필요)
- 더 많은 리소스

### 3. 외부 큐 시스템 도입

- BullMQ, Redis Queue 등
- 더 나은 재시도 메커니즘
- 우선순위 기반 처리

---

## 🎯 즉시 적용할 우선순위

1. ✅ **재시도 메커니즘 수정** (최우선)
2. ✅ **파일 크기 제한 15MB로 조정**
3. ✅ **배치 크기 최적화**
4. ✅ **타임아웃 시 처리 중단 로직 추가**

---

## 📊 예상 효과

### 재시도 메커니즘 수정 후:
- 첫 시도 실패 → 자동 재시도 (최대 3회)
- 성공률: 0% → 30-50% (재시도로 성공 가능)

### 파일 크기 제한 조정 후:
- 처리 시간: 10-12분 → 8-10분
- 성공률: 0% → 60-70%

### 배치 크기 최적화 후:
- 처리 시간: 10-12분 → 9-11분
- 성공률: 추가 10-20% 향상

---

## ⚠️ 제약 사항

### Vercel Pro 플랜 한계

- **최대 실행 시간**: 10분 (600초) - 변경 불가
- **메모리**: 1024MB - 변경 불가
- **동시 실행**: 제한적

### 해결책

1. **파일 크기 제한**: 15MB 이하 권장
2. **파일 분할**: 큰 파일은 분할 처리
3. **Enterprise 플랜**: 더 긴 실행 시간 필요 시

