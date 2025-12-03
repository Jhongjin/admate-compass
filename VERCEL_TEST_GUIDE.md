# Vercel 배포 후 크롤러 테스트 가이드

## 🚀 빠른 시작

실제 프로덕션 환경과 동일한 조건에서 크롤러를 테스트할 수 있습니다.

## 📋 단계별 가이드

### 1. 코드 커밋 및 푸시

```bash
git add .
git commit -m "크롤러 V2 업데이트"
git push
```

### 2. Vercel 자동 배포 확인

1. Vercel 대시보드 접속: https://vercel.com/dashboard
2. 프로젝트 선택
3. **Deployments** 탭에서 최신 배포 상태 확인
4. 배포 완료 대기 (보통 1-3분)

### 3. 테스트 페이지 접속

배포 완료 후 다음 URL로 접속:

```
https://your-app.vercel.app/test/crawler-v2
```

**참고**: `your-app`은 실제 Vercel 프로젝트 이름으로 변경하세요.

### 4. 크롤링 테스트

1. **URL 입력**: 크롤링할 URL을 입력 (한 줄에 하나씩)
2. **옵션 설정**:
   - 하위 페이지 발견: 체크/해제
   - 최대 깊이: 1-4
   - 최대 URL 수: 1-200
   - 타임아웃: 5000-60000ms
3. **크롤링 시작** 버튼 클릭
4. 결과 확인

## ✅ Vercel 환경의 장점

- **자동 Chromium 제공**: Chrome 설치 불필요
- **프로덕션 환경과 동일**: 실제 서비스와 같은 조건
- **빠른 배포**: Git 푸시만으로 자동 배포
- **로그 확인**: Vercel 대시보드에서 실시간 로그 확인

## 🔍 문제 해결

### 배포 실패 시

1. Vercel 대시보드 → **Deployments** → 실패한 배포 클릭
2. **Build Logs** 확인
3. 에러 메시지 확인 및 수정

### 크롤링 실패 시

1. Vercel 대시보드 → **Functions** → `/api/crawler-v2/crawl`
2. **Logs** 탭에서 에러 확인
3. 타임아웃 설정 확인 (기본 5분)

## 📊 모니터링

### Vercel 대시보드에서 확인 가능한 정보

- **Functions**: API 실행 시간 및 에러율
- **Logs**: 실시간 로그 스트림
- **Analytics**: 요청 수 및 응답 시간

## 💡 팁

1. **프리뷰 배포 활용**: Pull Request마다 자동으로 프리뷰 배포가 생성됩니다
2. **환경 변수 확인**: Vercel 대시보드 → Settings → Environment Variables
3. **타임아웃 설정**: Vercel Pro 플랜은 최대 300초까지 지원

## 🔗 관련 링크

- [Vercel 문서](https://vercel.com/docs)
- [크롤러 V2 README](./src/lib/crawler-v2/README.md)
- [API 엔드포인트](./src/app/api/crawler-v2/crawl/route.ts)

