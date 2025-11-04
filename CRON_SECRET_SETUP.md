# CRON_SECRET 설정 가이드

## 🔒 보안 설정 완료

Vercel Cron Jobs의 보안 권장사항에 따라 `CRON_SECRET` 검증 기능을 추가했습니다.

### ✅ 적용된 API
1. `/api/jobs/consume` - 큐 처리 워커
2. `/api/admin/logs/process-alerts` - 알림 처리 (이미 적용됨)

---

## 📋 설정 방법

### 1. Vercel 대시보드에서 환경 변수 추가

1. **Vercel 대시보드** 접속
2. 프로젝트 선택 → **Settings** → **Environment Variables**
3. 다음 환경 변수 추가:
   ```
   이름: CRON_SECRET
   값: [랜덤 문자열 생성]
   환경: Production, Preview, Development (모두 선택)
   ```

### 2. CRON_SECRET 생성 방법

#### 방법 1: 온라인 생성기 사용
- https://www.random.org/strings/ 접속
- 길이: 32자 이상
- 문자 유형: 영문자 + 숫자

#### 방법 2: 터미널에서 생성
```bash
# Linux/Mac
openssl rand -hex 32

# Windows PowerShell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

#### 방법 3: Node.js로 생성
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. 예시 값
```
CRON_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
```

---

## 🔍 동작 방식

### GET 요청 (Vercel Cron Jobs)
- **항상 검증**: Authorization 헤더 필수
- Vercel이 자동으로 `Bearer [CRON_SECRET]` 헤더를 포함하여 호출

### POST 요청 (수동 호출)
- **선택적 검증**: Authorization 헤더가 있는 경우에만 검증
- 관리자 페이지에서 수동 호출 시 헤더 없이도 동작 가능

---

## ⚠️ 주의사항

1. **CRON_SECRET 미설정 시**
   - 개발 환경에서는 경고만 표시하고 실행
   - 프로덕션 환경에서는 보안 위험

2. **환경 변수 적용**
   - 환경 변수 추가 후 **재배포 필요**
   - 즉시 적용되지 않음

3. **보안**
   - CRON_SECRET은 절대 코드에 직접 작성하지 마세요
   - GitHub/GitLab에 커밋하지 마세요
   - 팀원과 공유 시 안전한 방법 사용 (1Password, Vault 등)

---

## ✅ 확인 방법

### 1. Vercel 로그 확인
- Vercel 대시보드 → Functions → `/api/jobs/consume`
- 최근 실행 로그에서 검증 성공 여부 확인

### 2. 테스트
```bash
# 올바른 토큰으로 테스트
curl -X GET https://your-domain.vercel.app/api/jobs/consume \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# 잘못된 토큰으로 테스트 (401 에러 예상)
curl -X GET https://your-domain.vercel.app/api/jobs/consume \
  -H "Authorization: Bearer wrong-secret"
```

---

## 📚 참고 자료

- [Vercel Cron Jobs 문서](https://vercel.com/docs/cron-jobs)
- [Vercel 환경 변수 설정](https://vercel.com/docs/concepts/projects/environment-variables)

