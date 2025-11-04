# Vercel Cron Jobs 메뉴 위치 가이드

## 📍 Vercel Cron 메뉴 찾기

### 방법 1: 프로젝트 설정에서 찾기
1. **Vercel 대시보드** (https://vercel.com) 접속
2. 프로젝트 선택
3. 상단 메뉴에서 **"Settings"** 클릭
4. 왼쪽 사이드바에서 다음 중 하나를 찾으세요:
   - **"Cron Jobs"** (직접 메뉴)
   - **"Deployments"** → "Cron Jobs" 탭
   - **"Functions"** → "Cron Jobs" 섹션

### 방법 2: Deployments 페이지에서 찾기
1. 프로젝트 선택
2. **"Deployments"** 메뉴 클릭
3. 상단 탭에서 **"Cron Jobs"** 또는 **"Crons"** 탭 확인

### 방법 3: API Routes에서 확인
1. 프로젝트 선택
2. **"Functions"** 또는 **"API Routes"** 메뉴 클릭
3. `/api/jobs/consume` 함수 찾기
4. 해당 함수 옆에 Cron 설정 표시 여부 확인

## ⚠️ 중요 사항

### Vercel Pro 플랜 필요
- **Cron Jobs는 Vercel Pro 플랜 이상에서만 사용 가능합니다**
- Free 플랜에서는 Cron Jobs 메뉴가 보이지 않을 수 있습니다
- `vercel.json`에 설정되어 있어도 Pro 플랜이 아니면 실행되지 않습니다

### 확인 방법
1. **대시보드에서 플랜 확인**:
   - 프로젝트 → Settings → Billing
   - 현재 플랜이 "Pro"인지 확인

2. **Cron 실행 로그 확인**:
   - Deployments → Functions 로그
   - `/api/jobs/consume` 호출 로그 확인
   - 최근 실행 시간 및 성공/실패 여부 확인

## 🔄 대안: 수동 실행

Cron이 설정되어 있지 않거나 실행되지 않는 경우:

1. **관리자 페이지에서 수동 실행**:
   - `/admin/queues` 페이지
   - "1건 처리" 버튼 클릭

2. **외부 Cron 서비스 사용**:
   - cron-job.org
   - EasyCron
   - GitHub Actions (무료)

3. **Supabase Edge Functions**:
   - `supabase/functions/processing-worker` 배포
   - Supabase Dashboard에서 Cron 설정

## 📊 현재 설정 확인

`vercel.json` 파일 확인:
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

이 설정이 있으면 Vercel에서 자동으로 Cron을 생성해야 합니다.

## 🛠️ 문제 해결

### Cron 메뉴가 보이지 않는 경우
1. **플랜 확인**: Pro 플랜인지 확인
2. **배포 확인**: 최신 배포가 완료되었는지 확인
3. **문서 확인**: Vercel 문서에서 Cron Jobs 위치 확인

### Cron이 실행되지 않는 경우
1. **로그 확인**: Deployments → Functions 로그
2. **수동 테스트**: `/api/jobs/consume` 직접 호출
3. **설정 확인**: `vercel.json`의 cron 설정이 올바른지 확인

