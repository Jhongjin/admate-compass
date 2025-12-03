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

#### 실제 사용 예시

**예시 1: 단일 페이지 크롤링**
```
URL: https://www.facebook.com/business/help
옵션:
- 하위 페이지 발견: 해제
- 최대 깊이: 1
- 최대 URL 수: 1
- 타임아웃: 30000ms
```

**예시 2: 하위 페이지 포함 크롤링**
```
URL: https://www.facebook.com/business/help
옵션:
- 하위 페이지 발견: 체크
- 최대 깊이: 2
- 최대 URL 수: 50
- 타임아웃: 60000ms
```

**예시 3: 여러 URL 배치 크롤링**
```
URL:
https://www.facebook.com/business/help
https://www.instagram.com/business/help
https://developers.facebook.com/docs

옵션:
- 하위 페이지 발견: 체크
- 최대 깊이: 2
- 최대 URL 수: 100
- 타임아웃: 60000ms
```

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

#### 일반적인 에러 및 해결 방법

**에러: "Browser launch failed"**
- **원인**: Chromium 초기화 실패
- **해결**: Vercel 환경에서는 자동으로 Chromium이 제공되므로, 배포를 다시 시도하거나 Vercel 지원팀에 문의

**에러: "Timeout exceeded"**
- **원인**: 크롤링 시간이 5분(300초)을 초과
- **해결**: 
  - `maxUrls` 값을 줄이기
  - `maxDepth` 값을 줄이기
  - 타임아웃 값을 조정 (단, Vercel Pro는 최대 300초)

**에러: "Network error"**
- **원인**: 대상 사이트 접근 불가 또는 네트워크 문제
- **해결**: 
  - URL이 올바른지 확인
  - 대상 사이트가 robots.txt로 차단하고 있는지 확인
  - `respectRobots` 옵션을 false로 설정 (권장하지 않음)

**에러: "Memory limit exceeded"**
- **원인**: 너무 많은 페이지를 동시에 크롤링
- **해결**: 
  - `maxUrls` 값을 줄이기
  - 배치 크기를 줄여서 여러 번 나눠서 크롤링

## 📊 모니터링

### Vercel 대시보드에서 확인 가능한 정보

- **Functions**: API 실행 시간 및 에러율
- **Logs**: 실시간 로그 스트림
- **Analytics**: 요청 수 및 응답 시간

## 💡 팁

1. **프리뷰 배포 활용**: Pull Request마다 자동으로 프리뷰 배포가 생성됩니다
2. **환경 변수 확인**: Vercel 대시보드 → Settings → Environment Variables
3. **타임아웃 설정**: Vercel Pro 플랜은 최대 300초까지 지원
4. **배치 크기 최적화**: 큰 사이트는 여러 번 나눠서 크롤링하는 것이 안정적입니다
5. **로깅 활용**: Vercel Functions 로그를 통해 크롤링 진행 상황을 실시간으로 확인할 수 있습니다

## ⚡ 성능 최적화

### 권장 설정

**작은 사이트 (10페이지 이하)**
- 최대 깊이: 2
- 최대 URL 수: 10
- 타임아웃: 30000ms

**중간 사이트 (10-50페이지)**
- 최대 깊이: 2
- 최대 URL 수: 50
- 타임아웃: 60000ms

**큰 사이트 (50페이지 이상)**
- 최대 깊이: 1-2
- 최대 URL 수: 100-200
- 타임아웃: 120000ms (2분)
- **권장**: 여러 번 나눠서 크롤링

### 성능 모니터링

Vercel 대시보드에서 다음 지표를 확인하세요:

- **Function Duration**: 평균 실행 시간
- **Function Invocations**: 호출 횟수
- **Error Rate**: 에러 발생률
- **Memory Usage**: 메모리 사용량

이 지표들을 통해 크롤링 성능을 최적화할 수 있습니다.

## 🔗 관련 링크

- [Vercel 문서](https://vercel.com/docs)
- [크롤러 V2 README](./src/lib/crawler-v2/README.md)
- [API 엔드포인트](./src/app/api/crawler-v2/crawl/route.ts)

## 📝 체크리스트

배포 전 확인사항:

- [ ] 코드가 Git에 커밋 및 푸시되었는지 확인
- [ ] Vercel 대시보드에서 배포 상태 확인
- [ ] 환경 변수가 올바르게 설정되었는지 확인
- [ ] 테스트 페이지 접속 가능 여부 확인
- [ ] 간단한 URL로 크롤링 테스트 실행
- [ ] Vercel Functions 로그에서 에러 확인

배포 후 확인사항:

- [ ] 크롤링 결과가 올바르게 표시되는지 확인
- [ ] 성능 지표가 정상 범위인지 확인
- [ ] 에러 로그가 없는지 확인
- [ ] 메모리 사용량이 정상인지 확인

