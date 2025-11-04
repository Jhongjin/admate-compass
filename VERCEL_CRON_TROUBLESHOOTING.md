# Vercel Cron Jobs 문제 해결 가이드

## 🔍 Cron Jobs 메뉴가 보이지 않는 경우

### 원인 1: Vercel 플랜 문제
**Cron Jobs는 Vercel Pro 플랜 이상에서만 사용 가능합니다.**

**확인 방법**:
1. Vercel 대시보드 → 프로젝트 선택
2. Settings → Billing
3. 현재 플랜 확인 (Free 플랜에서는 Cron Jobs 사용 불가)

---

### 원인 2: 메뉴 위치 변경
Vercel UI 업데이트로 메뉴 위치가 변경되었을 수 있습니다.

**찾아볼 위치**:
1. **Settings → Cron Jobs** (왼쪽 사이드바)
2. **Deployments → Cron Jobs** 탭
3. **Functions → Cron Jobs** 섹션
4. 프로젝트 루트 → **"Crons"** 메뉴

---

### 원인 3: vercel.json 설정이 배포되지 않음
`vercel.json`에 cron 설정이 있어도 배포 시 인식되지 않을 수 있습니다.

**확인 방법**:
1. 최신 배포가 완료되었는지 확인
2. 배포 로그에서 cron 설정 오류 확인
3. `vercel.json` 파일이 프로젝트 루트에 있는지 확인

---

## ✅ 대안 해결 방법

### 방법 1: 수동 큐 처리 (즉시 사용 가능)
**가장 간단하고 확실한 방법**

1. `/admin/docs` 페이지 접속
2. 왼쪽 하단 "처리 큐 (요약)" 패널
3. **"1건 처리"** 버튼 클릭
4. 큐에 등록된 작업이 즉시 처리됨

**장점**:
- 즉시 사용 가능
- Vercel 플랜 제한 없음
- 큐 상태를 실시간으로 확인 가능

---

### 방법 2: 외부 Cron 서비스 사용
**Vercel Pro 플랜이 없는 경우**

**추천 서비스**:
1. **cron-job.org** (무료)
   - URL: `https://your-domain.vercel.app/api/jobs/consume`
   - Schedule: `*/1 * * * *` (1분마다)
   - Method: POST

2. **EasyCron** (무료/유료)
   - 설정 방법 동일

3. **GitHub Actions** (무료)
   - `.github/workflows/queue-worker.yml` 생성
   - 매분마다 API 호출

**예시 (cron-job.org)**:
```
URL: https://your-project.vercel.app/api/jobs/consume
Method: POST
Schedule: */1 * * * *
```

---

### 방법 3: Supabase Edge Functions 사용
**Supabase에서 직접 큐 처리**

1. Supabase Dashboard 접속
2. Edge Functions → `processing-worker` 배포
3. Database → Cron Jobs 설정
4. 매분마다 Edge Function 호출

---

## 🔧 현재 상황 확인

### 1. 큐 상태 확인
Supabase에서 직접 확인:
```sql
SELECT 
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM processing_jobs
GROUP BY status;
```

### 2. 큐 워커 실행 여부 확인
Vercel Functions 로그에서 확인:
1. Vercel 대시보드 → 프로젝트
2. **Deployments** 또는 **Functions** 메뉴
3. `/api/jobs/consume` 함수 클릭
4. 로그에서 호출 기록 확인
   - 1분마다 호출되는지 확인
   - 최근 호출 시간 확인

### 3. 수동 실행 테스트
```bash
# 터미널에서 실행
curl -X POST https://your-project.vercel.app/api/jobs/consume
```

성공 응답:
```json
{
  "success": true,
  "message": "대기 중인 잡이 없습니다."
}
```
또는
```json
{
  "success": true,
  "jobId": "...",
  "status": "completed"
}
```

---

## 📊 권장 해결책

### 즉시 사용 (권장)
**수동 큐 처리 버튼 사용**
- `/admin/docs` 페이지에서 "1건 처리" 버튼 클릭
- 큐에 작업이 있을 때만 클릭
- 가장 간단하고 확실한 방법

### 자동화 (선택)
**외부 Cron 서비스 사용**
1. cron-job.org 가입
2. API 엔드포인트 등록
3. 1분마다 자동 실행 설정

---

## ⚠️ 주의사항

1. **Vercel Free 플랜**: Cron Jobs 사용 불가
2. **함수 타임아웃**: Pro 플랜에서도 함수 실행 시간 제한 있음
3. **비용**: 외부 Cron 서비스는 무료/유료 플랜 확인 필요

---

## 🎯 다음 단계

1. ✅ Vercel 플랜 확인 (Settings → Billing)
2. ✅ `/admin/docs`에서 수동 큐 처리 테스트
3. ✅ 필요시 외부 Cron 서비스 설정
4. ✅ 큐 워커가 정상 작동하는지 확인

