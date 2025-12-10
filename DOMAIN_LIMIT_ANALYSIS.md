# 도메인 제한 옵션 기능 분석 및 개선 제안

## 현재 동작 분석

### MaxDepth별 실제 동작

#### MaxDepth 1-2: 정확히 같은 도메인만 허용
```typescript
// UrlDiscovery.ts:349-352
if (maxDepth >= 1 && maxDepth <= 2) {
  if (config.domainLimit !== false) {
    return false; // 다른 도메인 제외
  }
}
```

**동작:**
- ✅ `example.com` → `example.com/page1` (허용)
- ❌ `example.com` → `sub.example.com/page1` (하위 도메인 제외)
- ❌ `example.com` → `other.com/page1` (외부 도메인 제외)

**domainLimit 영향:**
- `domainLimit: true` (기본값): 다른 도메인 제외 (하지만 이미 같은 도메인만 허용하므로 의미 없음)
- `domainLimit: false`: 다른 도메인 허용 (하지만 maxDepth 1-2는 이미 같은 도메인만 허용하므로 여전히 제외됨)

**결론:** `domainLimit`이 의미 없음 (maxDepth 1-2는 이미 같은 도메인만 허용)

---

#### MaxDepth 3: 같은 도메인 + 하위 도메인 허용
```typescript
// UrlDiscovery.ts:343-347
if (maxDepth >= 3) {
  if (!this.isSubdomain(urlDomain, baseDomain)) {
    return false; // 하위 도메인이 아니면 제외
  }
}
```

**동작:**
- ✅ `example.com` → `example.com/page1` (허용)
- ✅ `example.com` → `sub.example.com/page1` (하위 도메인 허용)
- ✅ `example.com` → `www.example.com/page1` (하위 도메인 허용)
- ❌ `example.com` → `other.com/page1` (외부 도메인 제외)

**domainLimit 영향:**
- 코드에서 `domainLimit`을 확인하지 않음
- `domainLimit`과 관계없이 하위 도메인은 항상 허용됨

**결론:** `domainLimit`이 의미 없음 (maxDepth 3는 이미 하위 도메인을 허용)

---

#### MaxDepth 4: 모든 도메인 허용
```typescript
// UrlDiscovery.ts:340-342
if (maxDepth >= 4) {
  // 모든 도메인 허용 (domainLimit과 관계없이)
}
```

**동작:**
- ✅ `example.com` → `example.com/page1` (허용)
- ✅ `example.com` → `sub.example.com/page1` (하위 도메인 허용)
- ✅ `example.com` → `other.com/page1` (외부 도메인 허용)

**domainLimit 영향:**
- 코드에서 `domainLimit`을 확인하지 않음
- `domainLimit`과 관계없이 모든 도메인이 항상 허용됨

**결론:** `domainLimit`이 의미 없음 (maxDepth 4는 이미 모든 도메인을 허용)

---

## 문제점

### 1. `domainLimit` 옵션이 실제로 작동하지 않음

**현재 코드의 문제:**
- `maxDepth`가 이미 도메인 필터링을 결정함
- `domainLimit`은 `maxDepth 1-2`에서만 체크되지만, 이미 같은 도메인만 허용하므로 의미 없음
- `maxDepth 3` 이상에서는 `domainLimit`을 전혀 확인하지 않음

**코드 위치:**
```typescript
// UrlDiscovery.ts:349-352
if (maxDepth >= 1 && maxDepth <= 2) {
  if (config.domainLimit !== false) {
    return false; // 하지만 이미 같은 도메인만 허용하므로 의미 없음
  }
}
```

### 2. 사용자 기대와 실제 동작 불일치

**사용자 기대:**
- `maxDepth 1-3`: 부모 도메인 + 하위 도메인 (기본값)
- `maxDepth 4`: 외부 도메인도 포함
- `domainLimit`: 하위 도메인만 크롤링하도록 제한

**실제 동작:**
- `maxDepth 1-2`: 같은 도메인만 (하위 도메인 제외)
- `maxDepth 3`: 같은 도메인 + 하위 도메인
- `maxDepth 4`: 모든 도메인
- `domainLimit`: 거의 의미 없음

---

## 개선 제안

### 옵션 1: `domainLimit`을 `maxDepth 3`에서도 작동하도록 수정

**목적:** `maxDepth 3`일 때 하위 도메인을 제외하고 같은 도메인만 크롤링할 수 있도록 함

**수정 내용:**
```typescript
// UrlDiscovery.ts 수정
if (urlDomain !== baseDomain) {
  const maxDepth = config.maxDepth ?? 3;
  if (maxDepth >= 4) {
    // maxDepth 4: 모든 도메인 허용 (domainLimit과 관계없이)
    // 모든 도메인 허용
  } else if (maxDepth >= 3) {
    // maxDepth 3: domainLimit에 따라 다름
    if (config.domainLimit === true) {
      // domainLimit이 true면 하위 도메인도 제외 (같은 도메인만)
      return false;
    } else {
      // domainLimit이 false면 하위 도메인 허용
      if (!this.isSubdomain(urlDomain, baseDomain)) {
        return false;
      }
    }
  } else {
    // maxDepth 1-2: 정확히 같은 도메인만 허용
    return false;
  }
}
```

**효과:**
- `maxDepth 3` + `domainLimit: true`: 같은 도메인만 (하위 도메인 제외)
- `maxDepth 3` + `domainLimit: false`: 같은 도메인 + 하위 도메인
- `maxDepth 4`: 모든 도메인 (domainLimit 무시)

---

### 옵션 2: `domainLimit` 옵션 제거 및 `maxDepth`만 사용

**목적:** 단순화 및 혼란 제거

**수정 내용:**
- `domainLimit` 옵션 제거
- `maxDepth`만으로 도메인 필터링 제어:
  - `maxDepth 1-2`: 같은 도메인만
  - `maxDepth 3`: 같은 도메인 + 하위 도메인
  - `maxDepth 4`: 모든 도메인

**장점:**
- 옵션 단순화
- 사용자 혼란 제거
- 코드 유지보수 용이

**단점:**
- `maxDepth 3`에서 하위 도메인을 제외할 수 없음

---

### 옵션 3: `domainLimit`을 독립적인 필터로 작동

**목적:** `maxDepth`와 독립적으로 도메인 필터링 제어

**수정 내용:**
```typescript
// domainLimit이 true면 하위 도메인도 제외
if (config.domainLimit === true) {
  if (urlDomain !== baseDomain) {
    return false; // 같은 도메인만 허용
  }
} else {
  // domainLimit이 false면 maxDepth에 따라 필터링
  // 기존 로직 유지
}
```

**효과:**
- `domainLimit: true`: 항상 같은 도메인만 (maxDepth 무시)
- `domainLimit: false`: maxDepth에 따라 필터링

---

## 추천 방안

**옵션 1 추천** (가장 유연함)

**이유:**
1. 사용자 기대에 부합: `maxDepth 3`에서도 하위 도메인 제외 가능
2. 기존 동작 유지: `domainLimit: false` (기본값)일 때는 기존과 동일
3. 명확한 의미: `domainLimit: true` = "같은 도메인만", `false` = "하위 도메인 포함"

**구현 우선순위:**
1. `UrlDiscovery.ts`의 `filterAndSort` 메서드 수정
2. `UrlDiscovery.ts`의 `discoverSubPages` 메서드 수정
3. 프론트엔드 UI에 설명 추가

---

## 사용자 가이드 (개선 후)

### MaxDepth별 동작

| MaxDepth | domainLimit | 허용 도메인 | 설명 |
|----------|-------------|-------------|------|
| 1-2 | true/false | 같은 도메인만 | 하위 도메인 제외 |
| 3 | true | 같은 도메인만 | 하위 도메인 제외 |
| 3 | false | 같은 도메인 + 하위 도메인 | 하위 도메인 포함 |
| 4 | true/false | 모든 도메인 | 외부 도메인 포함 |

### 권장 사용법

1. **같은 도메인만 크롤링:** `maxDepth: 1-2` 또는 `maxDepth: 3` + `domainLimit: true`
2. **하위 도메인 포함:** `maxDepth: 3` + `domainLimit: false`
3. **모든 도메인 포함:** `maxDepth: 4`



