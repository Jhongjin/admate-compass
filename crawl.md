# 크롤링 현황 및 문제점 정리

## 📊 현재 크롤 현황

### 성공 사례
- **하위 페이지 크롤링**: `ads.naver.com` 도메인에서 **28개 문서** 성공적으로 크롤링 및 인덱싱 완료
- **작업 처리**: Cron Job이 정상적으로 실행되어 작업을 처리하고 있음
- **문서 인덱싱**: 크롤링된 문서들이 정상적으로 인덱싱되어 데이터베이스에 저장됨

### 실패 사례
- **메인 페이지 크롤링 실패**: `https://ko-kr.facebook.com/business` 크롤링 실패
  - 에러 메시지: "로그인 페이지가 반환되어 크롤링할 수 없습니다. 공개 접근이 가능한 문서를 사용해 주세요."
  - 작업 상태: `failed`
  - 결과: 메인 페이지만 실패, 하위 페이지는 성공

## 🔍 문제점 분석

### 1. Facebook/Instagram URL 크롤링 실패

#### 문제 현상
- Facebook/Instagram URL에 접근 시 로그인 페이지로 리다이렉트됨
- Puppeteer를 사용해도 충분한 콘텐츠를 추출하지 못함 (최소 10자 이상 필요)
- 메인 페이지 크롤링 실패로 작업이 `failed` 상태로 마킹됨

#### 기술적 제약사항
- Facebook은 봇 접근을 차단하거나 로그인을 요구함
- Puppeteer로도 로그인 페이지를 우회할 수 없음
- 공개 접근 가능한 페이지가 아닌 경우 크롤링 불가능

#### 현재 구현 상태
```typescript
// src/app/api/jobs/consume/route.ts
// Facebook/Instagram URL은 처음부터 Puppeteer만 사용
const isFacebookUrl = targetUrl.includes('facebook.com') || targetUrl.includes('instagram.com');
if (isFacebookUrl) {
  // Puppeteer로 직접 크롤링 시도
  // 최소 콘텐츠 길이: 10자
  // 실패 시 명확한 에러 메시지 반환
}
```

### 2. Vercel 로그 부재

#### 문제 현상
- Vercel 로그에서 `/api/jobs/consume` 엔드포인트 로그가 보이지 않음
- 다른 엔드포인트(`/api/jobs/enqueue`, `/api/admin/upload-new` 등)는 정상적으로 로그가 표시됨

#### 가능한 원인
- Cron Job이 실행되지만 로그가 캡처되지 않음
- Vercel의 로그 필터링 문제
- 함수 실행 시간이 너무 짧아 로그가 기록되지 않음

#### 현재 구현 상태
```typescript
// src/app/api/jobs/consume/route.ts
export async function GET(request: NextRequest) {
  console.error('[CRITICAL] 🔔 GET 핸들러 호출됨 (Cron Job 또는 수동 호출)');
  // 즉시 로그 출력하도록 구현됨
}
```

### 3. 부분 성공 처리

#### 현재 동작
- 메인 페이지 크롤링 실패 시 작업이 `failed`로 마킹됨
- 하지만 하위 페이지는 정상적으로 크롤링되어 인덱싱됨
- 프론트엔드에서 "부분 성공" 메시지 표시

#### 문제점
- 메인 페이지 실패로 인해 전체 작업이 실패로 표시됨
- 실제로는 유용한 하위 페이지들이 크롤링되었음에도 불구하고 실패로 처리됨

## 🛠️ 시도한 해결 방법들

### 1. Puppeteer 최적화
- ✅ 초기 대기 시간 증가 (3초 → 5초)
- ✅ 스크롤 거리 및 최대 높이 증가 (200px, 3000px)
- ✅ 메인 콘텐츠 영역 대기 (`waitForSelector`)
- ✅ 최소 콘텐츠 길이 완화 (100자 → 50자 → 30자 → 10자)
- ✅ 링크, 메타 정보, 모든 텍스트 추출 시도

### 2. 에러 처리 개선
- ✅ 상세한 에러 로그 추가
- ✅ 콘텐츠 미리보기 출력 (500자)
- ✅ 페이지 분석 결과 로그 (링크 개수, 로그인 페이지 여부)

### 3. 코드 구조 개선
- ✅ Facebook URL 중복 로직 제거
- ✅ fetch 경로에서 로그인 페이지 감지 로직 삭제
- ✅ Facebook URL은 처음부터 Puppeteer만 사용하도록 정리

### 4. 로깅 강화
- ✅ GET 핸들러 시작 부분에 즉시 로그 추가
- ✅ 요청 정보 상세 로그
- ✅ CRON_SECRET 검증 로그

## ❌ 해결되지 않은 문제들

### 1. Facebook 로그인 페이지 우회 불가능
**근본 원인**: Facebook이 봇 접근을 차단하거나 로그인을 요구함
**해결 방법**: 
- 공개 접근 가능한 Facebook 페이지 사용
- 또는 Facebook API를 통한 공식 데이터 접근
- 또는 사용자 인증을 통한 크롤링 (현재 불가능)

### 2. Vercel 로그 부재
**근본 원인**: 불명확 (Cron Job 실행은 되지만 로그가 캡처되지 않음)
**해결 방법**:
- Vercel 대시보드에서 로그 필터 확인
- 다른 로깅 서비스 도입 검토
- 또는 Supabase 로그 테이블에 직접 기록

### 3. 부분 성공 처리 로직 부재
**근본 원인**: 메인 페이지 실패 시 전체 작업을 실패로 처리
**해결 방법**:
- 메인 페이지 실패 시에도 하위 페이지 크롤링 결과를 반영
- 작업 상태를 `partial_success`로 추가
- 또는 메인 페이지 실패를 경고로 처리하고 하위 페이지 성공을 우선시

## 📝 권장 사항

### 즉시 적용 가능
1. **공개 접근 가능한 URL 사용**: Facebook Business 페이지 대신 공개 접근 가능한 페이지 사용
2. **부분 성공 처리 로직 추가**: 메인 페이지 실패 시에도 하위 페이지 성공을 반영
3. **에러 메시지 개선**: "메인 페이지는 실패했지만 하위 페이지 X개는 성공적으로 크롤링되었습니다" 메시지 표시

### 장기적 개선
1. **Facebook API 통합**: 공식 API를 통한 데이터 접근 검토
2. **대체 크롤링 방법**: Selenium, Playwright 등 다른 도구 검토
3. **로깅 시스템 개선**: Vercel 로그 외에 별도 로깅 시스템 도입

## 🔗 관련 파일

- `src/app/api/jobs/consume/route.ts`: 크롤링 작업 처리 로직
- `src/lib/services/PuppeteerCrawlingService.ts`: Puppeteer 크롤링 서비스
- `src/app/test/crawl-to-index/page.tsx`: 크롤링 테스트 페이지
- `vercel.json`: Cron Job 설정

## 📅 최근 변경 이력

- **2024-12-09**: Facebook 크롤링 중복 로직 제거
- **2024-12-09**: 최소 콘텐츠 길이 10자로 완화
- **2024-12-09**: 상세 에러 로그 추가
- **2024-12-09**: GET 핸들러 즉시 로깅 추가






