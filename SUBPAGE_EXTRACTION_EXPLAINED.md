# 하위 페이지 추출 로직 상세 설명

## 시드 페이지: `https://ads.naver.com/`, maxDepth: 2

### 🎯 목표
시드 페이지에서 하위 페이지를 찾아서 추출하는 방법을 쉽게 설명합니다.

---

## 📋 하위 페이지 추출 과정 (단계별)

### 1단계: 페이지 로드 및 렌더링

**기술**: **Puppeteer** (헤드리스 브라우저)

```
1. 브라우저 열기 (Chrome/Chromium)
2. https://ads.naver.com/ 페이지 접속
3. JavaScript 실행 대기 (8초)
4. 페이지 스크롤 (5번 반복, 각 3초 대기)
5. 네비게이션 메뉴 클릭/호버 (서브 메뉴 열기)
```

**왜 필요한가?**
- `ads.naver.com`은 **SPA (Single Page Application)**입니다
- JavaScript로 동적으로 링크가 생성됩니다
- 스크롤하면 lazy loading으로 더 많은 링크가 나타납니다
- 메뉴를 클릭해야 서브 메뉴가 보입니다

---

### 2단계: 링크 추출

**추출 대상**: 페이지의 **모든 링크**

#### 2-1. HTML에서 링크 찾기

**찾는 방법**:
```javascript
// 다양한 선택자로 링크 찾기
- 'a[href]'                    // 일반 <a> 태그
- 'nav a[href]'                // 네비게이션 메뉴 링크
- 'header a[href]'            // 헤더 링크
- '[class*="menu"] a[href]'    // 메뉴 클래스 포함 링크
- '[class*="nav"] a[href]'     // nav 클래스 포함 링크
- '[data-href]'                // data-href 속성
- '[data-link]'                // data-link 속성
- '[data-url]'                 // data-url 속성
- '[onclick*="location"]'      // onclick 이벤트로 링크 동작
- iframe 내부 링크             // iframe 안의 링크도 추출
```

**실제 예시** (ads.naver.com에서 찾은 링크):
```
✅ <a href="/start/sales">온라인 판매 목적</a>
✅ <a href="/start/offline">오프라인 방문 목적</a>
✅ <a href="/sa">검색광고</a>
✅ <a href="/sub/guarantee">보장형 디스플레이 광고</a>
✅ <nav><a href="/recommend/intro">광고 추천</a></nav>
```

#### 2-2. 링크 속성 추출

각 링크에서 다음 정보를 추출:
- **URL**: `href` 속성 값
- **텍스트**: 링크 안의 텍스트 (예: "온라인 판매 목적")
- **위치**: 네비게이션, 헤더, 푸터 등

---

### 3단계: URL 정규화 및 변환

**상대 경로를 절대 경로로 변환**:
```
상대 경로: /start/sales
절대 경로: https://ads.naver.com/start/sales

상대 경로: ../help
절대 경로: https://ads.naver.com/help
```

---

### 4단계: 필터링 (maxDepth 2 기준)

#### 4-1. 도메인 필터링

**maxDepth 2**: **같은 도메인만** 허용

```
✅ https://ads.naver.com/start/sales     (같은 도메인)
✅ https://ads.naver.com/sub/guarantee   (같은 도메인)
❌ https://help.naver.com/               (다른 도메인 - 제외)
❌ https://www.facebook.com/             (다른 도메인 - 제외)
```

#### 4-2. 깊이 필터링

**깊이 계산**:
```
시드: https://ads.naver.com/ (루트)

URL: https://ads.naver.com/start
→ 경로: ['start']
→ 깊이: 1 ✅

URL: https://ads.naver.com/start/sales
→ 경로: ['start', 'sales']
→ 깊이: 2 ✅

URL: https://ads.naver.com/start/sales/detail
→ 경로: ['start', 'sales', 'detail']
→ 깊이: 3 ❌ (maxDepth 2 초과 - 제외)
```

#### 4-3. 품질 필터링

**제외되는 링크**:
- 정적 리소스: `.css`, `.js`, `.jpg`, `.png` 등
- API 엔드포인트: `/api/`, `/graphql` 등
- 로그인/계정 페이지: `/login/`, `/account/` 등
- 법적 고지: `/terms/`, `/privacy/` 등

**포함되는 링크**:
- 콘텐츠 페이지: `/start/`, `/sa/`, `/sub/` 등
- 도움말: `/help/` (유용한 정보일 수 있음)

---

### 5단계: 품질 점수 계산 및 정렬

**점수 기준**:
- 같은 도메인: +200점
- 텍스트가 있는 링크: +30점
- 깊이가 낮은 링크: +20점
- 경로가 짧은 링크: +15점
- 쿼리 파라미터 없음: +10점

**정렬**: 점수가 높은 순서대로

---

## 🔍 실제 추출 예시

### 시드: `https://ads.naver.com/`
### maxDepth: 2

**1단계: 페이지 로드**
```
Puppeteer로 페이지 접속
→ JavaScript 실행 대기 (8초)
→ 스크롤 5번 (각 3초 대기)
→ 메뉴 클릭/호버 (5초 대기)
```

**2단계: 링크 추출**
```
페이지에서 발견된 링크 (예시):
- <a href="/start/sales">온라인 판매 목적</a>
- <a href="/start/offline">오프라인 방문 목적</a>
- <a href="/start/website">웹사이트 방문 목적</a>
- <a href="/sa">검색광고</a>
- <a href="/sub/guarantee">보장형 디스플레이 광고</a>
- <a href="/help">도움말</a>
- <a href="https://help.naver.com/">네이버 고객센터</a>
- <a href="https://www.facebook.com/">Facebook</a>
```

**3단계: 필터링 (maxDepth 2)**
```
✅ https://ads.naver.com/start/sales      (깊이 1, 같은 도메인)
✅ https://ads.naver.com/start/offline     (깊이 1, 같은 도메인)
✅ https://ads.naver.com/sa                (깊이 1, 같은 도메인)
✅ https://ads.naver.com/sub/guarantee     (깊이 2, 같은 도메인)
✅ https://ads.naver.com/help              (깊이 1, 같은 도메인)
❌ https://ads.naver.com/start/sales/detail (깊이 3 - 제외)
❌ https://help.naver.com/                 (다른 도메인 - 제외)
❌ https://www.facebook.com/               (다른 도메인 - 제외)
```

**최종 결과**:
```
발견된 하위 페이지 (5개):
1. https://ads.naver.com/start/sales
2. https://ads.naver.com/start/offline
3. https://ads.naver.com/sa
4. https://ads.naver.com/sub/guarantee
5. https://ads.naver.com/help
```

---

## 🛠️ 기술 스택

### 1. Puppeteer
- **역할**: 실제 브라우저처럼 페이지를 렌더링
- **이유**: JavaScript로 동적 생성되는 링크를 추출하기 위해

### 2. DOM 쿼리
- **역할**: HTML에서 링크 요소 찾기
- **방법**: CSS 선택자 사용 (`querySelectorAll`)

### 3. URL 정규화
- **역할**: 상대 경로를 절대 경로로 변환
- **방법**: `new URL(href, baseUrl)`

### 4. 깊이 계산
- **역할**: 시드 URL로부터의 거리 계산
- **방법**: 경로 세그먼트 수 비교

---

## ⚠️ 현재 문제점 및 해결 방법

### 문제: 하위 페이지 추출이 제대로 안됨

**가능한 원인**:

1. **JavaScript 실행 시간 부족**
   - 해결: 대기 시간 증가 (현재 8초)

2. **메뉴가 열리지 않음**
   - 해결: 메뉴 클릭/호버 이벤트 추가 (현재 구현됨)

3. **스크롤이 충분하지 않음**
   - 해결: 스크롤 횟수 증가 (현재 5번)

4. **링크 선택자가 부족함**
   - 해결: 다양한 선택자 추가 (현재 구현됨)

5. **필터링이 너무 강함**
   - 해결: 필터링 규칙 완화 (현재 구현됨)

### 디버깅 방법

**로그 확인**:
```
[discoverFromLinks] DOM 상태 확인:
- 전체 <a> 태그: 233개
- href 속성 있는 링크: 232개
- 현재 URL: https://ads.naver.com/help/agency
- readyState: complete
```

**문제 진단**:
- 링크가 0개면: JavaScript 실행 시간 부족 또는 페이지 로드 실패
- 링크가 적으면: 필터링이 너무 강함
- 다른 도메인만 나오면: 도메인 필터링 문제

---

## 📊 추출 과정 요약

```
1. Puppeteer로 페이지 로드
   ↓
2. JavaScript 실행 대기 (8초)
   ↓
3. 스크롤 및 메뉴 클릭 (동적 콘텐츠 로드)
   ↓
4. DOM에서 모든 링크 추출
   - <a href="...">
   - nav, header, footer 링크
   - data-href, data-link 등
   ↓
5. 상대 경로를 절대 경로로 변환
   ↓
6. 필터링 (도메인, 깊이, 품질)
   ↓
7. 품질 점수 계산 및 정렬
   ↓
8. 최종 하위 페이지 목록 반환
```

---

## 💡 핵심 포인트

1. **모든 링크를 추출**: 페이지의 모든 `<a>` 태그, 네비게이션, 헤더, 푸터 링크를 찾습니다
2. **동적 콘텐츠 대기**: JavaScript 실행과 스크롤을 통해 동적으로 생성되는 링크를 기다립니다
3. **메뉴 열기**: 네비게이션 메뉴를 클릭/호버하여 숨겨진 서브 메뉴 링크를 찾습니다
4. **스마트 필터링**: 도메인, 깊이, 품질 기준으로 관련성 높은 링크만 선택합니다

