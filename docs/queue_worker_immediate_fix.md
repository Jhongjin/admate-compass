# 큐 워커 즉시 실행 가이드

## 문제 상황
DOCX 파일이 큐에서 2분 이상 처리 중인 상태

## 즉시 확인 사항

### 1. 큐 워커 실행 여부 확인

**Vercel 로그 확인:**
1. Vercel 대시보드 → 프로젝트 → Logs
2. "🚀 큐 처리 시작" 로그 검색
3. 최근 5분 내 로그 확인

**예상 로그:**
```
🚀 큐 처리 시작: 2025-01-XX...
🔍 큐에서 작업 조회 중...
📋 작업 조회 완료: XXms
```

**로그가 없으면:**
- Vercel Cron Job이 실행되지 않고 있음
- 수동 실행 필요

### 2. 수동 실행 방법

**방법 1: 관리자 페이지에서 실행**
1. `/admin/docs` 페이지 접속
2. 좌측 하단 "처리 큐 (요약)" 패널 확인
3. "1건 처리" 버튼 클릭

**방법 2: API 직접 호출**
```bash
# 터미널에서 실행
curl -X POST https://your-domain.vercel.app/api/jobs/consume
```

**방법 3: Vercel Function Logs에서 확인**
1. Vercel 대시보드 → Functions → `/api/jobs/consume`
2. 최근 실행 로그 확인
3. 에러가 있는지 확인

### 3. 현재 처리 상태 확인

**Supabase SQL 쿼리:**
```sql
-- 현재 처리 중인 작업 확인
SELECT 
  id,
  document_id,
  job_type,
  status,
  attempts,
  error,
  created_at,
  started_at,
  finished_at,
  EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at))) as elapsed_seconds
FROM processing_jobs
WHERE status IN ('queued', 'processing', 'retrying')
ORDER BY created_at DESC
LIMIT 10;
```

**예상 결과:**
- `status = 'queued'`: 큐 워커가 아직 실행되지 않음
- `status = 'processing'`: 큐 워커가 실행 중이지만 느림
- `elapsed_seconds > 120`: 2분 이상 처리 중

### 4. 병목 지점 확인

**Vercel 로그에서 확인할 로그:**
1. `📥 Storage 다운로드 시작` - Storage 다운로드 시작
2. `✅ Storage 다운로드 완료` - 다운로드 완료 (소요 시간 확인)
3. `📄 DOCX 파싱 시작` - DOCX 파싱 시작
4. `✅ DOCX 파싱 완료` - 파싱 완료 (소요 시간 확인)

**어느 단계에서 멈추는지 확인:**
- Storage 다운로드가 느리면 → Storage 문제
- DOCX 파싱이 느리면 → mammoth 라이브러리 문제
- 둘 다 없으면 → 큐 워커가 실행되지 않음

## 즉시 조치

### 1. 수동 실행
관리자 페이지에서 "1건 처리" 버튼 클릭

### 2. 로그 확인
Vercel 대시보드에서 최근 로그 확인

### 3. 상태 확인
Supabase에서 `processing_jobs` 테이블 확인

