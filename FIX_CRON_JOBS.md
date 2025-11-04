# Vercel Cron Jobs 설정 문제 해결

## 🔍 발견된 문제

`vercel.json`에는 두 개의 cron job이 설정되어 있지만, Vercel 대시보드에는 하나만 표시됩니다:

**설정된 cron jobs**:
1. ✅ `/api/admin/logs/process-alerts` - `0 9 * * *` (매일 9시) - **표시됨**
2. ❌ `/api/jobs/consume` - `*/1 * * * *` (매분) - **표시되지 않음**

---

## 🛠️ 해결 방법

### 방법 1: 수동으로 Cron Job 추가 (Vercel 대시보드)

1. **Cron Jobs 페이지**에서 **"Add Cron Job"** 또는 **"Create Cron Job"** 버튼 클릭
2. 다음 정보 입력:
   - **Path**: `/api/jobs/consume`
   - **Schedule**: `*/1 * * * *` (또는 "Every minute" 선택)
3. 저장

### 방법 2: vercel.json 재배포

1. **로컬에서 확인**:
   ```bash
   # vercel.json 파일 확인
   cat vercel.json
   ```

2. **변경사항 커밋 및 푸시**:
   ```bash
   git add vercel.json
   git commit -m "Fix cron jobs configuration"
   git push
   ```

3. **Vercel 자동 배포 대기** 또는 **수동 배포**:
   - Vercel 대시보드 → Deployments → Redeploy

4. **배포 후 확인**:
   - Cron Jobs 페이지에서 `/api/jobs/consume` cron job이 추가되었는지 확인

### 방법 3: Vercel CLI로 배포

```bash
# Vercel CLI 설치 (없는 경우)
npm i -g vercel

# 프로젝트 디렉토리에서
vercel --prod

# 배포 후 Cron Jobs 확인
```

---

## ⚠️ 주의사항

### Cron Job이 인식되지 않는 이유

1. **배포 완료 전**: Cron Jobs는 배포가 완료된 후에만 생성됩니다
2. **설정 오류**: `vercel.json` 문법 오류가 있으면 cron job이 생성되지 않을 수 있습니다
3. **경로 문제**: `/api/jobs/consume` 경로가 실제로 존재하는지 확인 필요

### 경로 확인

`/api/jobs/consume` 경로가 올바른지 확인:
- 파일 위치: `src/app/api/jobs/consume/route.ts`
- 배포 후 실제 경로: `/api/jobs/consume`

---

## ✅ 즉시 해결책 (수동 추가)

Vercel 대시보드에서 직접 추가하는 것이 가장 빠릅니다:

1. **Cron Jobs 페이지**로 이동
2. **"Add Cron Job"** 또는 **"Create"** 버튼 클릭
3. 설정:
   - **Path**: `/api/jobs/consume`
   - **Schedule**: `*/1 * * * *` 또는 "Every minute"
4. **저장**

---

## 🔍 확인 방법

### 1. Cron Job 실행 확인
- Vercel 대시보드 → Cron Jobs → `/api/jobs/consume` → **"View Logs"** 클릭
- 최근 실행 시간 및 성공/실패 여부 확인

### 2. 수동 실행 테스트
- Cron Jobs 페이지에서 **"Run"** 버튼 클릭
- Functions 로그에서 실행 결과 확인

### 3. 큐 상태 확인
- Supabase에서 `processing_jobs` 테이블 확인
- `queued` 상태의 작업이 `processing` 또는 `completed`로 변경되는지 확인

---

## 📊 현재 상태

- ✅ Cron Jobs 메뉴 찾음
- ✅ `/api/admin/logs/process-alerts` cron job 정상 작동
- ❌ `/api/jobs/consume` cron job 누락
- ✅ 수동 큐 처리 가능 (대안)

---

## 🎯 권장 조치

1. **즉시**: Vercel 대시보드에서 `/api/jobs/consume` cron job 수동 추가
2. **확인**: "Run" 버튼으로 수동 실행 테스트
3. **모니터링**: "View Logs"로 실행 로그 확인
4. **대안**: 필요시 수동 큐 처리 버튼 사용

