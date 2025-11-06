# 큐 워커 수동 실행 가이드

## 문제 상황
큐 워커가 자동으로 실행되지 않거나, 실행되더라도 매우 느린 경우

## 즉시 조치: 수동 실행

### 방법 1: 관리자 페이지에서 실행 (가장 쉬움)
1. `/admin/docs` 페이지 접속
2. 좌측 하단 **"처리 큐 (요약)"** 패널 확인
3. **"1건 처리"** 버튼 클릭
4. 처리 완료까지 대기 (보통 10-30초)

### 방법 2: API 직접 호출
```bash
# 터미널에서 실행
curl -X POST https://your-domain.vercel.app/api/jobs/consume
```

또는 브라우저에서:
- URL: `https://your-domain.vercel.app/api/jobs/consume`
- Method: POST
- 개발자 도구 Network 탭에서 확인

### 방법 3: Vercel Functions에서 직접 실행
1. Vercel 대시보드 → Functions
2. `/api/jobs/consume` 선택
3. "Invoke" 버튼 클릭 (있는 경우)

## Vercel Cron Job 확인

### Cron Job이 실행되고 있는지 확인
1. Vercel 대시보드 → **Cron Jobs** 탭
2. `/api/jobs/consume` cron job 확인
3. **"Last Run"** 시간 확인
4. 최근 5분 내에 실행되었는지 확인

### Cron Job이 없는 경우
1. Vercel 대시보드 → **Settings** → **Cron Jobs**
2. "Add Cron Job" 클릭
3. 다음 설정:
   - **Path**: `/api/jobs/consume`
   - **Schedule**: `*/1 * * * *` (매분)
   - **Timezone**: Asia/Seoul

## 즉시 테스트

### 1. 수동 실행
관리자 페이지에서 "1건 처리" 버튼 클릭

### 2. 로그 확인
Vercel 대시보드 → Logs에서 다음 로그 확인:
- `🚀 큐 처리 시작`
- `📥 Storage 다운로드`
- `📄 DOCX 파싱`
- `✅ 청크 저장 완료`

### 3. 처리 시간 확인
각 단계별 소요 시간 확인하여 어느 단계가 느린지 파악

