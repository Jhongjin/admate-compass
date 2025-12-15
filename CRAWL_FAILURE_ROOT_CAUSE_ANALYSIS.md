# 크롤링 실패 근본 원인 분석 (1-10)

## 📊 현재 상황

### 확인된 사실
1. ✅ **Cron Job 정상 작동**: `/api/jobs/consume`가 매분 실행 중
2. ✅ **작업 등록 성공**: 작업이 `queued` 상태로 등록됨
3. ✅ **작업 시작됨**: `started_at`이 있으므로 작업은 시작됨
4. ❌ **대부분 실패**: 10개 중 9개가 `failed` 상태

### 문제의 핵심
**작업은 실행되지만 크롤링 과정에서 실패하고 있습니다.**

---

## 🔍 근본 원인 분석 (1-10)

### 1. **Puppeteer 초기화 실패** ⚠️ 가장 가능성 높음

**문제점:**
```typescript:src/lib/services/PuppeteerCrawlingService.ts
async init(): Promise<void> {
  // Vercel 서버리스 환경에서 Chromium 초기화 실패 가능
  this.browser = await puppeteerCore.launch({
    args: chromiumArgs,
    // ...
  });
}
```

**근본 원인:**
- Vercel 서버리스 환경에서 Puppeteer/Chromium 초기화 실패
- 메모리 부족 또는 타임아웃
- `@sparticuz/chromium` 패키지 문제

**확인 방법:**
```sql
-- 에러 메시지에서 "Puppeteer", "browser", "Chromium" 키워드 확인
SELECT error, result->>'errorMessage' as error_msg
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED' AND status = 'failed'
ORDER BY created_at DESC LIMIT 5;
```

---

### 2. **타임아웃 발생** ⚠️ 높은 가능성

**문제점:**
```typescript:src/app/api/jobs/consume/route.ts
export const maxDuration = 300; // 5분
// 하지만 크롤링이 5분 이상 걸릴 수 있음
```

**근본 원인:**
- Vercel 함수 실행 시간 제한 (5분) 초과
- Facebook/Instagram 크롤링은 특히 오래 걸림
- 하위 페이지 크롤링 시 더 오래 걸림

**확인 방법:**
```sql
-- 실행 시간 확인
SELECT 
  id,
  EXTRACT(EPOCH FROM (finished_at - started_at)) as duration_seconds,
  error
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED' AND status = 'failed'
ORDER BY created_at DESC LIMIT 5;
```

**해결책:**
- `maxDuration`을 600초로 증가 (이미 `vercel.json`에 설정됨)
- 타임아웃 시 부분 성공 처리 (이미 구현됨)

---

### 3. **Facebook/Instagram 접근 차단**

**문제점:**
```typescript:src/app/api/jobs/consume/route.ts
// Facebook/Instagram URL의 경우 Puppeteer 사용
const isFacebookUrl = targetUrl.includes('facebook.com') || targetUrl.includes('instagram.com');
if (isFacebookUrl) {
  const puppeteerResult = await puppeteerService.crawlMetaPage(targetUrl, false, true);
}
```

**근본 원인:**
- Facebook/Instagram이 봇 탐지로 접근 차단
- 로그인 페이지로 리다이렉트
- IP 기반 차단

**확인 방법:**
- 에러 메시지에서 "로그인", "blocked", "403", "401" 확인
- Vercel Functions 로그에서 HTTP 상태 코드 확인

---

### 4. **네트워크 타임아웃**

**문제점:**
```typescript:src/app/api/jobs/consume/route.ts
const response = await fetch(targetUrl, {
  headers: commonHeaders,
  signal: AbortSignal.timeout(30000), // 30초 타임아웃
  redirect: 'follow',
});
```

**근본 원인:**
- 외부 URL 접근 시 네트워크 지연
- Facebook/Instagram 서버 응답 지연
- Vercel 서버리스 환경의 네트워크 제한

---

### 5. **메모리 부족 (OOM)**

**문제점:**
- Puppeteer는 메모리를 많이 사용
- Vercel 서버리스 함수의 메모리 제한
- 여러 페이지를 동시에 크롤링할 때 메모리 부족

**근본 원인:**
- Vercel Hobby 플랜: 1024MB 메모리 제한
- Vercel Pro 플랜: 3008MB 메모리 제한
- Puppeteer + Chromium은 최소 500MB 이상 필요

**확인 방법:**
- Vercel Functions 로그에서 "Out of memory" 또는 "OOM" 확인
- 메모리 사용량 모니터링

---

### 6. **에러 처리 중 예외 발생**

**문제점:**
```typescript:src/app/api/jobs/consume/route.ts
} catch (crawlError) {
  // 에러 처리 중 또 다른 에러 발생 가능
  await supabase.from('processing_jobs').update({ status: 'failed' });
}
```

**근본 원인:**
- 에러 처리 중 Supabase 연결 실패
- 에러 처리 중 타임아웃
- 중첩된 에러로 인한 처리 실패

---

### 7. **Supabase 연결 문제**

**문제점:**
```typescript:src/app/api/jobs/consume/route.ts
const supabase = await createPureClient();
// Supabase 연결 실패 또는 타임아웃
```

**근본 원인:**
- Supabase 연결 풀 고갈
- 네트워크 문제
- Supabase 서비스 장애

---

### 8. **하위 페이지 크롤링 중 에러**

**문제점:**
```typescript:src/app/api/jobs/consume/route.ts
// 하위 페이지 크롤링 시 여러 페이지를 병렬 처리
// 하나라도 실패하면 전체 실패 가능
```

**근본 원인:**
- 하위 페이지 중 하나가 실패하면 전체 작업 실패
- 에러 핸들링이 개별 페이지 단위로 되어 있지 않음
- 부분 실패 시 전체 롤백

---

### 9. **문서 저장 실패**

**문제점:**
```typescript:src/app/api/jobs/consume/route.ts
// 크롤링은 성공했지만 문서 저장 실패
const { error: upsertError } = await supabase
  .from('documents')
  .upsert(documentData);
```

**근본 원인:**
- Supabase upsert 실패
- 데이터베이스 제약 조건 위반
- 트랜잭션 실패

---

### 10. **환경 변수 누락**

**문제점:**
- Puppeteer 초기화에 필요한 환경 변수 누락
- Supabase 연결에 필요한 환경 변수 누락

**근본 원인:**
- Vercel 환경 변수 설정 누락
- 로컬과 프로덕션 환경 변수 불일치

---

## 🎯 즉시 확인 사항

### 1. 실패한 작업의 에러 메시지 확인

```sql
-- 최근 실패한 작업의 상세 에러 확인
SELECT 
  id,
  error as error_message,
  result->>'error' as result_error,
  result->>'errorMessage' as result_error_message,
  result->>'errorName' as result_error_name,
  EXTRACT(EPOCH FROM (finished_at - started_at)) as duration_seconds,
  payload->>'url' as url
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status = 'failed'
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 10;
```

### 2. Vercel Functions 로그 확인

- Vercel 대시보드 → Functions → `/api/jobs/consume` → View Logs
- 에러 메시지, 스택 트레이스 확인
- 메모리 사용량, 실행 시간 확인

### 3. Puppeteer 초기화 로그 확인

- `[CRITICAL] ❌ CRAWL_SEED 처리 오류` 로그 확인
- Puppeteer 관련 에러 메시지 확인

---

## 🔧 해결 방안

### 즉시 적용 가능한 해결책

1. **에러 로깅 강화**
   - 실패한 작업의 상세 에러를 `result` 필드에 저장
   - Vercel Functions 로그에 더 자세한 정보 기록

2. **타임아웃 처리 개선**
   - 부분 성공 시 `completed`로 처리 (이미 구현됨)
   - 타임아웃 시간 증가 검토

3. **재시도 로직 강화**
   - 일시적 에러(네트워크, 타임아웃)는 재시도
   - 영구적 에러(접근 차단)는 즉시 실패 처리

4. **Puppeteer 초기화 개선**
   - 초기화 실패 시 재시도
   - 브라우저 풀 관리 개선

### 장기 개선 사항

1. **비동기 크롤링**
   - 큰 사이트는 배치로 나누어 처리
   - 작업을 여러 단계로 분할

2. **모니터링 및 알림**
   - 실패율 모니터링
   - 실패 시 알림 발송

3. **대체 크롤링 방법**
   - Puppeteer 실패 시 Cheerio로 fallback
   - 외부 크롤링 서비스 연동 검토

---

## 📝 다음 단계

1. **에러 메시지 확인**: 위 SQL 쿼리 실행하여 실제 에러 확인
2. **로그 분석**: Vercel Functions 로그에서 상세 에러 확인
3. **원인 특정**: 가장 빈번한 에러 유형 파악
4. **해결책 적용**: 원인에 맞는 해결책 적용
5. **테스트**: 수정 후 재테스트

---

## 🔗 관련 파일

- `src/app/api/jobs/consume/route.ts`: 큐 처리 로직
- `src/lib/services/PuppeteerCrawlingService.ts`: Puppeteer 크롤링 서비스
- `supabase/check_recent_failed_crawl_errors.sql`: 에러 확인 쿼리






