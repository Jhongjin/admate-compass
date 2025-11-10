# JavaScript 렌더링과 정적 HTML 파싱 차이 설명

## 1. 기본 개념

### 1.1 정적 HTML (Static HTML)

**정의**: 서버에서 완전히 렌더링된 HTML을 클라이언트에 전송하는 방식

**특징**:
- 서버가 HTML을 완전히 생성하여 전송
- 브라우저는 받은 HTML을 그대로 표시
- JavaScript 없이도 모든 콘텐츠가 HTML에 포함됨

**예시 HTML**:
```html
<!DOCTYPE html>
<html>
<head>
    <title>마케팅 API</title>
</head>
<body>
    <h1>마케팅 API</h1>
    <p>마케팅 API는 Graph API 엔드포인트의 컬렉션입니다.</p>
    <ul>
        <li>기본 광고 만들기</li>
        <li>캠페인 관리</li>
        <li>광고 최적화</li>
    </ul>
</body>
</html>
```

**크롤링 가능 여부**: ✅ **가능**
- Fetch로 HTML을 받으면 모든 콘텐츠가 이미 포함되어 있음
- Cheerio로 바로 파싱 가능

### 1.2 동적 HTML (Dynamic HTML) / JavaScript 렌더링

**정의**: 서버에서 기본 HTML만 전송하고, JavaScript가 실행되어 콘텐츠를 동적으로 생성하는 방식

**특징**:
- 서버는 빈 HTML 또는 기본 구조만 전송
- 브라우저에서 JavaScript가 실행되어 콘텐츠 생성
- 실제 콘텐츠는 JavaScript 실행 후에만 나타남

**예시 HTML (초기)**:
```html
<!DOCTYPE html>
<html>
<head>
    <title>마케팅 API</title>
</head>
<body>
    <div id="app"></div>
    <script>
        // JavaScript가 실행되어야 콘텐츠가 나타남
        fetch('/api/content')
            .then(res => res.json())
            .then(data => {
                document.getElementById('app').innerHTML = `
                    <h1>${data.title}</h1>
                    <p>${data.description}</p>
                `;
            });
    </script>
</body>
</html>
```

**크롤링 가능 여부**: ❌ **불가능** (Cheerio만으로는)
- Fetch로 받은 HTML에는 실제 콘텐츠가 없음
- JavaScript 실행이 필요하지만 Cheerio는 JavaScript를 실행하지 않음
- 결과: 빈 `<div id="app"></div>`만 보임

## 2. 구체적인 예시

### 2.1 ✅ 크롤링 가능한 경우 (정적 HTML)

#### 예시 1: 전통적인 웹사이트
```
URL: https://developers.facebook.com/docs/marketing-api

서버 응답:
- HTML에 모든 텍스트가 포함됨
- 링크가 <a href="..."> 형태로 직접 포함됨
- JavaScript는 단순히 상호작용만 담당
```

**크롤링 결과**:
```javascript
// Fetch로 받은 HTML
const html = `
  <html>
    <body>
      <h1>마케팅 API</h1>
      <p>마케팅 API는 Graph API 엔드포인트의 컬렉션입니다.</p>
      <a href="/docs/marketing-api/get-started">시작하기</a>
    </body>
  </html>
`;

// Cheerio로 파싱 가능
const $ = cheerio.load(html);
const title = $('h1').text(); // "마케팅 API" ✅
const links = $('a').map((i, el) => $(el).attr('href')).get(); // ["/docs/marketing-api/get-started"] ✅
```

#### 예시 2: 서버 사이드 렌더링 (SSR)
```
Next.js, Nuxt.js 등의 SSR 프레임워크로 만든 사이트
- 서버에서 HTML을 완전히 렌더링하여 전송
- JavaScript는 클라이언트에서 하이드레이션만 수행
```

**크롤링 결과**: ✅ 가능 (서버에서 렌더링된 HTML이 이미 포함됨)

### 2.2 ❌ 크롤링 불가능한 경우 (JavaScript 렌더링 필요)

#### 예시 1: React/Vue/Angular SPA (Single Page Application)
```
URL: https://example-spa.com/dashboard

서버 응답 (초기):
<html>
  <body>
    <div id="root"></div>
    <script src="/app.js"></script>
  </body>
</html>

실제 콘텐츠는 app.js가 실행된 후에만 나타남
```

**크롤링 결과**:
```javascript
// Fetch로 받은 HTML
const html = `
  <html>
    <body>
      <div id="root"></div>
      <script src="/app.js"></script>
    </body>
  </html>
`;

// Cheerio로 파싱
const $ = cheerio.load(html);
const content = $('#root').text(); // "" (빈 문자열) ❌
// 실제 콘텐츠는 JavaScript 실행 후에만 나타남
```

#### 예시 2: API 기반 동적 콘텐츠 로딩
```
페이지 구조:
1. 서버는 기본 HTML만 전송
2. JavaScript가 API를 호출하여 데이터 가져옴
3. JavaScript가 DOM에 콘텐츠 삽입
```

**예시 코드**:
```html
<div id="content"></div>
<script>
  fetch('/api/marketing-api-docs')
    .then(res => res.json())
    .then(data => {
      document.getElementById('content').innerHTML = `
        <h1>${data.title}</h1>
        <p>${data.description}</p>
        <ul>
          ${data.items.map(item => `<li>${item}</li>`).join('')}
        </ul>
      `;
    });
</script>
```

**크롤링 결과**: ❌ 불가능
- Fetch로 받은 HTML에는 `<div id="content"></div>`만 있음
- 실제 콘텐츠는 JavaScript가 API를 호출한 후에만 나타남
- Cheerio는 JavaScript를 실행하지 않으므로 빈 div만 보임

#### 예시 3: 무한 스크롤 (Infinite Scroll)
```
페이지 구조:
- 초기 HTML에는 첫 몇 개 항목만 포함
- 사용자가 스크롤하면 JavaScript가 추가 콘텐츠 로드
```

**크롤링 결과**: ❌ 부분적으로만 가능
- 초기 HTML에 있는 콘텐츠만 크롤링 가능
- 스크롤 후 로드되는 콘텐츠는 크롤링 불가능

#### 예시 4: 클라이언트 사이드 라우팅
```
React Router, Vue Router 등을 사용한 SPA
- URL이 변경되어도 서버 요청 없음
- JavaScript가 라우팅 처리
```

**크롤링 결과**: ❌ 불가능
- Fetch는 초기 HTML만 받음
- 다른 라우트의 콘텐츠는 JavaScript로만 접근 가능

## 3. 실제 크롤링 시나리오

### 3.1 Meta Developer 문서 (현재 크롤링 대상)

**URL**: `https://developers.facebook.com/docs/marketing-api`

**페이지 타입**: ✅ **정적 HTML (서버 사이드 렌더링)**

**크롤링 가능 여부**: ✅ **가능**

**이유**:
- 서버에서 HTML을 완전히 렌더링하여 전송
- 모든 텍스트와 링크가 HTML에 포함됨
- JavaScript는 단순히 상호작용(탭 전환, 모달 등)만 담당

**현재 구현**:
```typescript
// Fetch로 HTML 받기
const response = await fetch(url);
const html = await response.text();

// 정규식으로 링크 추출 (현재 방식)
const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;

// 또는 Cheerio 사용 (개선 가능)
const $ = cheerio.load(html);
const links = $('a[href]').map((i, el) => $(el).attr('href')).get();
```

### 3.2 React로 만든 대시보드 (크롤링 불가능 예시)

**URL**: `https://example.com/admin/dashboard`

**페이지 타입**: ❌ **SPA (JavaScript 렌더링)**

**크롤링 가능 여부**: ❌ **불가능** (Cheerio만으로는)

**이유**:
- 서버는 빈 HTML만 전송: `<div id="root"></div>`
- 실제 콘텐츠는 React가 렌더링
- Fetch로 받은 HTML에는 콘텐츠가 없음

**필요한 도구**: Puppeteer 또는 Playwright
- 실제 브라우저를 실행하여 JavaScript 실행
- 페이지가 완전히 로드될 때까지 대기
- 렌더링된 HTML을 추출

## 4. Cheerio vs Puppeteer 비교

### 4.1 Cheerio (정적 HTML 파싱)

**작동 방식**:
```
1. Fetch로 HTML 받기
2. Cheerio로 HTML 파싱
3. DOM 조작 및 데이터 추출
```

**장점**:
- ⚡ 매우 빠름 (수 밀리초)
- 💰 비용 없음
- 📦 가벼움 (수 MB)
- 🔋 메모리 사용량 낮음

**단점**:
- ❌ JavaScript 실행 불가
- ❌ 동적 콘텐츠 크롤링 불가
- ❌ SPA 크롤링 불가

**사용 가능한 경우**:
- ✅ 전통적인 웹사이트
- ✅ 서버 사이드 렌더링 (SSR) 사이트
- ✅ 정적 HTML 사이트
- ✅ Meta Developer 문서 같은 문서 사이트

### 4.2 Puppeteer (JavaScript 렌더링)

**작동 방식**:
```
1. 실제 Chrome 브라우저 실행
2. 페이지 로드 및 JavaScript 실행 대기
3. 렌더링된 HTML 추출
4. DOM 조작 및 데이터 추출
```

**장점**:
- ✅ JavaScript 실행 가능
- ✅ 동적 콘텐츠 크롤링 가능
- ✅ SPA 크롤링 가능
- ✅ 실제 브라우저와 동일한 환경

**단점**:
- 🐌 느림 (수 초)
- 💰 Vercel에서 추가 설정 필요
- 📦 무거움 (40-50MB)
- 🔋 메모리 사용량 높음

**사용 가능한 경우**:
- ✅ React/Vue/Angular SPA
- ✅ JavaScript로 콘텐츠를 로드하는 사이트
- ✅ 무한 스크롤 사이트
- ✅ 클라이언트 사이드 라우팅 사이트

## 5. 현재 프로젝트에 대한 분석

### 5.1 크롤링 대상: Meta Developer 문서

**페이지 타입**: ✅ **정적 HTML (서버 사이드 렌더링)**

**증거**:
- 현재 fetch fallback으로도 텍스트 추출 가능
- 링크가 HTML에 직접 포함되어 있음
- JavaScript는 상호작용만 담당

**결론**: ✅ **Cheerio로 충분**

### 5.2 크롤링 불가능한 경우 (현재 프로젝트에서)

**예시**:
- React로 만든 Meta Business Suite 대시보드
- JavaScript로 API를 호출하여 콘텐츠를 로드하는 페이지
- 클라이언트 사이드에서만 렌더링되는 SPA

**해결 방법**:
- `@sparticuz/chromium` + `puppeteer-core` 사용
- 또는 외부 브라우저 서비스 사용

## 6. 실전 예시 코드

### 6.1 Cheerio로 크롤링 가능한 경우

```typescript
// ✅ 작동함: 정적 HTML
const response = await fetch('https://developers.facebook.com/docs/marketing-api');
const html = await response.text();

const $ = cheerio.load(html);
const title = $('h1').text(); // "마케팅 API" ✅
const links = $('a[href]').map((i, el) => $(el).attr('href')).get(); // 모든 링크 ✅
```

### 6.2 Cheerio로 크롤링 불가능한 경우

```typescript
// ❌ 작동 안함: JavaScript 렌더링 필요
const response = await fetch('https://example-spa.com/dashboard');
const html = await response.text();

const $ = cheerio.load(html);
const content = $('#root').text(); // "" (빈 문자열) ❌
// 실제 콘텐츠는 JavaScript 실행 후에만 나타남
```

### 6.3 Puppeteer로 크롤링 가능한 경우

```typescript
// ✅ 작동함: JavaScript 렌더링
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto('https://example-spa.com/dashboard');
await page.waitForSelector('#content'); // JavaScript 실행 대기

const html = await page.content(); // 렌더링된 HTML
const $ = cheerio.load(html);
const content = $('#content').text(); // 실제 콘텐츠 ✅
```

## 7. 요약

### 크롤링 가능 (Cheerio만으로)
- ✅ 서버에서 완전히 렌더링된 HTML
- ✅ 전통적인 웹사이트
- ✅ SSR (서버 사이드 렌더링) 사이트
- ✅ Meta Developer 문서 같은 문서 사이트

### 크롤링 불가능 (Puppeteer 필요)
- ❌ React/Vue/Angular SPA
- ❌ JavaScript로 API를 호출하여 콘텐츠 로드
- ❌ 무한 스크롤 (초기 콘텐츠만 가능)
- ❌ 클라이언트 사이드 라우팅

### 현재 프로젝트
- ✅ **Meta Developer 문서는 정적 HTML**이므로 Cheerio로 충분
- ✅ 현재 fetch fallback 방식도 작동하지만, Cheerio로 개선 가능
- ❌ 만약 JavaScript 렌더링이 필요한 페이지를 크롤링해야 한다면 Puppeteer 필요

