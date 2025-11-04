# Vercel Cron Job 추가 방법

## ⚠️ 중요 발견

**Vercel 대시보드에는 Cron Job을 수동으로 생성하는 버튼이 없습니다.**

Vercel의 Cron Jobs는 **오직 `vercel.json` 파일을 통해서만** 관리됩니다. 대시보드에서는 기존 cron jobs를 확인, 실행, 로그 확인만 가능합니다.

---

## ✅ 해결 방법

### 방법 1: vercel.json 확인 및 재배포 (권장)

1. **현재 vercel.json 확인**:
   ```json
   {
     "crons": [
       {
         "path": "/api/admin/logs/process-alerts",
         "schedule": "0 9 * * *"
       },
       {
         "path": "/api/jobs/consume",
         "schedule": "*/1 * * * *"
       }
     ]
   }
   ```

2. **설정이 올바른지 확인**:
   - ✅ 경로: `/api/jobs/consume` (앞에 `/` 필수)
   - ✅ 스케줄: `*/1 * * * *` (매분)

3. **변경사항 커밋 및 푸시**:
   ```bash
   git add vercel.json
   git commit -m "Add /api/jobs/consume cron job"
   git push
   ```

4. **Vercel 자동 배포 대기**:
   - GitHub/GitLab에 푸시하면 자동 배포 시작
   - 배포 완료 후 Cron Jobs 페이지에서 확인

5. **배포 후 확인**:
   - Vercel 대시보드 → Settings → Cron Jobs
   - `/api/jobs/consume` cron job이 추가되었는지 확인

---

### 방법 2: Vercel CLI로 배포 (수동)

1. **Vercel CLI 설치** (없는 경우):
   ```bash
   npm i -g vercel
   ```

2. **프로젝트 디렉토리에서 로그인**:
   ```bash
   vercel login
   ```

3. **프로덕션 배포**:
   ```bash
   vercel --prod
   ```

4. **배포 후 확인**:
   - Vercel 대시보드 → Settings → Cron Jobs
   - `/api/jobs/consume` cron job 확인

---

### 방법 3: 배포 로그 확인

배포가 완료되었는데도 cron job이 보이지 않으면:

1. **Vercel 대시보드 → Deployments**
2. 최신 배포 클릭
3. **Build Logs** 확인:
   - `vercel.json` 파싱 오류가 있는지 확인
   - Cron job 생성 메시지 확인

4. **Functions 로그 확인**:
   - `/api/jobs/consume` 경로가 실제로 존재하는지 확인
   - 파일 위치: `src/app/api/jobs/consume/route.ts`

---

### 방법 4: 경로 문제 해결

만약 cron job이 생성되지 않는다면:

1. **경로 확인**:
   - 파일 경로: `src/app/api/jobs/consume/route.ts`
   - API 경로: `/api/jobs/consume` (앞에 `/` 필수)

2. **경로 수정** (필요시):
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

3. **재배포**:
   ```bash
   git add vercel.json
   git commit -m "Fix cron job path"
   git push
   ```

---

## 🔍 문제 진단

### Cron Job이 표시되지 않는 이유

1. **배포 미완료**: Cron Jobs는 배포 완료 후에만 생성됩니다
2. **설정 오류**: `vercel.json` 문법 오류가 있으면 cron job이 생성되지 않습니다
3. **경로 문제**: API 경로가 실제로 존재하지 않으면 cron job이 생성되지 않습니다
4. **배포 오류**: 배포 중 오류가 발생하면 cron job이 생성되지 않을 수 있습니다

### 확인 방법

1. **배포 상태 확인**:
   - Vercel 대시보드 → Deployments
   - 최신 배포가 성공적으로 완료되었는지 확인

2. **Functions 확인**:
   - Vercel 대시보드 → Functions
   - `/api/jobs/consume` 함수가 존재하는지 확인

3. **수동 실행 테스트**:
   ```bash
   curl -X POST https://your-project.vercel.app/api/jobs/consume
   ```
   - 성공하면 경로는 정상
   - 실패하면 경로 문제 가능

---

## 📊 현재 상태

- ✅ `vercel.json`에 `/api/jobs/consume` cron job 설정됨
- ❌ Vercel 대시보드에 표시되지 않음
- ✅ `/api/jobs/consume` API 경로는 존재함 (`src/app/api/jobs/consume/route.ts`)

---

## 🎯 권장 조치

1. **즉시**: `vercel.json` 확인 및 재배포
2. **확인**: 배포 완료 후 Cron Jobs 페이지에서 확인
3. **테스트**: Cron Job의 "Run" 버튼으로 수동 실행 테스트
4. **모니터링**: "View Logs"로 실행 로그 확인

---

## 💡 참고

Vercel Cron Jobs는:
- **대시보드에서 수동 생성 불가**: `vercel.json`을 통해서만 관리
- **배포 시 자동 생성**: 배포가 완료되면 자동으로 cron jobs 생성
- **대시보드 기능**: 확인, 실행, 로그 확인만 가능

따라서 cron job을 추가하려면:
1. `vercel.json` 파일 수정
2. 변경사항 커밋 및 푸시
3. 배포 완료 대기
4. Cron Jobs 페이지에서 확인

