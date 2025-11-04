# 큐 워커 실행 가이드

## 📋 큐 워커 확인 방법

### 1. 관리자 큐 페이지에서 확인
**URL**: `/admin/queues`

**확인 항목**:
- 큐 상태: `queued`, `processing`, `completed`, `failed`
- 작업 타입: `PDF_PARSE`, `DOCX_PARSE`, `OCR`, `CRAWL`, `EMBEDDING`
- 우선순위: 1-10 (높을수록 우선 처리)
- 시작/종료 시간

**수동 처리**:
- "1건 처리" 버튼 클릭 → `/api/jobs/consume` API 호출
- 큐에서 우선순위가 높은 작업 1건을 처리

### 2. 문서 관리 페이지에서 확인
**URL**: `/admin/docs`

**확인 위치**:
- 왼쪽 하단 "처리 큐 (요약)" 패널
- Queued/Processing/Failed 개수 표시

### 3. Supabase 직접 확인
**SQL 쿼리**:
```sql
-- 큐 상태 확인
SELECT 
  status,
  COUNT(*) as count
FROM processing_jobs
GROUP BY status;

-- 대기 중인 작업 확인
SELECT 
  id,
  document_id,
  job_type,
  priority,
  scheduled_at,
  created_at
FROM processing_jobs
WHERE status = 'queued'
ORDER BY priority DESC, scheduled_at ASC
LIMIT 10;
```

## 🔄 큐 워커 실행 방법

### 방법 1: 수동 실행 (현재)
1. `/admin/queues` 페이지 접속
2. "1건 처리" 버튼 클릭
3. 큐에서 작업을 하나씩 처리

### 방법 2: API 직접 호출
```bash
# 터미널에서 실행
curl -X POST http://localhost:3000/api/jobs/consume
```

### 방법 3: 자동 실행 (권장)
**Vercel Cron Jobs 사용**:
1. `vercel.json`에 cron 설정 추가
2. 정기적으로 `/api/jobs/consume` 호출

**예시 `vercel.json`**:
```json
{
  "crons": [
    {
      "path": "/api/jobs/consume",
      "schedule": "*/1 * * * *"
    }
  ]
}
```

**또는 Supabase Edge Functions 사용**:
- `supabase/functions/processing-worker` 디렉토리에 이미 구현되어 있음
- Supabase Dashboard에서 Edge Function으로 배포 후 cron 설정

## ⚠️ 현재 상태

**큐 워커는 수동 실행 모드입니다.**

- ✅ 큐에 작업 등록: 정상 작동
- ✅ 큐 상태 확인: `/admin/queues`에서 가능
- ❌ 자동 처리: 설정 필요 (수동으로 "1건 처리" 클릭 필요)

## 🚀 권장 설정

### 즉시 적용 (수동)
큐에 작업이 쌓이면 `/admin/queues` 페이지에서 "1건 처리" 버튼을 클릭하여 처리합니다.

### 자동화 (선택사항)
1. **Vercel Cron Jobs**: Vercel Pro 플랜에서 사용 가능
2. **Supabase Edge Functions**: Supabase Dashboard에서 설정
3. **외부 Cron 서비스**: cron-job.org 등 사용

## 📊 모니터링

큐 상태를 모니터링하려면:
- `/admin/queues`: 상세 큐 상태
- `/admin/docs`: 큐 요약 (Queued/Processing/Failed 개수)

