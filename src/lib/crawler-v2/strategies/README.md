# 벤더별 제목 추출 전략 가이드

## 개요

각 벤더(NAVER, META, KAKAO, GOOGLE 등)마다 페이지 구조가 다르기 때문에, 제목 추출 로직도 벤더별로 독립적으로 관리됩니다.

## 구조

```
strategies/
├── TitleExtractionStrategy.ts      # 전략 인터페이스
├── TitleStrategyManager.ts          # 전략 관리자 (전략 등록 및 선택)
├── NaverAdsFAQTitleStrategy.ts      # Naver Ads FAQ 전략
├── DefaultTitleStrategy.ts          # 기본 전략 (fallback)
└── README.md                        # 이 파일
```

## 새로운 벤더 전략 추가 방법

### 1. 전략 클래스 생성

새로운 벤더의 제목 추출 전략을 위한 클래스를 생성합니다.

예: `MetaHelpTitleStrategy.ts`

```typescript
import { Page } from 'puppeteer-core';
import { TitleExtractionStrategy, TitleExtractionResult } from './TitleExtractionStrategy';

export class MetaHelpTitleStrategy implements TitleExtractionStrategy {
  getVendorType(): string {
    return 'META';
  }

  async canHandle(url: string, page: Page): Promise<boolean> {
    // 이 전략이 적용 가능한 URL 패턴 확인
    return url.includes('facebook.com/help') || 
           url.includes('instagram.com/help') ||
           url.includes('meta.com/help');
  }

  async extractTitle(url: string, page: Page): Promise<TitleExtractionResult> {
    // Meta 페이지에 특화된 제목 추출 로직
    // 예: 특정 클래스명, 데이터 속성 등을 사용
    
    const title = await page.evaluate(() => {
      // Meta 페이지의 제목 추출 로직
      const titleElement = document.querySelector('.help-title, h1.help-title');
      return titleElement?.textContent?.trim() || null;
    });

    return {
      title: title,
      source: 'meta-help-strategy'
    };
  }
}
```

### 2. 전략 등록

`TitleStrategyManager.ts`에 새 전략을 등록합니다.

```typescript
import { MetaHelpTitleStrategy } from './MetaHelpTitleStrategy';

export class TitleStrategyManager {
  constructor() {
    // 기존 전략들...
    this.strategies.push(new NaverAdsFAQTitleStrategy());
    
    // 새 전략 추가
    this.strategies.push(new MetaHelpTitleStrategy());
    
    // 기본 전략은 항상 마지막
    this.strategies.push(new DefaultTitleStrategy());
  }
}
```

### 3. 테스트

새로운 벤더 URL로 크롤링을 테스트하여 제목이 올바르게 추출되는지 확인합니다.

## 주의사항

### ✅ 해야 할 것

1. **각 벤더별 전략은 독립적으로 관리**
   - 새로운 벤더 추가 시 기존 전략 파일을 수정하지 말 것
   - 새로운 전략 클래스를 생성할 것

2. **명확한 URL 패턴 매칭**
   - `canHandle` 메서드에서 정확한 URL 패턴을 확인할 것
   - 다른 벤더의 URL과 충돌하지 않도록 주의

3. **디버깅 로그 추가**
   - 제목 추출 과정을 추적할 수 있도록 로그 추가
   - 벤더별 전략임을 명시하는 로그 포함

4. **문서화**
   - 각 전략 클래스에 JSDoc 주석 추가
   - 적용 대상, 특화 사항, 주의사항 명시

### ❌ 하지 말아야 할 것

1. **기존 전략 수정 금지**
   - 다른 벤더의 전략을 수정하지 말 것
   - Naver Ads FAQ 전략을 Meta용으로 수정하지 말 것

2. **전략 간 의존성 생성 금지**
   - 한 전략이 다른 전략에 의존하지 않도록 할 것
   - 각 전략은 독립적으로 동작해야 함

3. **전역 상태 사용 금지**
   - 전략 간 상태를 공유하지 말 것
   - 각 전략은 순수 함수로 동작해야 함

## 현재 등록된 전략

### 1. NaverAdsFAQTitleStrategy
- **적용 대상**: `ads.naver.com/help/faq/*`
- **특화 사항**: 
  - `content_title` 클래스를 가진 요소를 최우선으로 추출
  - Y 좌표가 음수여도 유효한 제목으로 처리 (스크롤 위치 고려)
  - 피드백 텍스트, UI 요소, 프로모션 텍스트 필터링
- **파일**: `NaverAdsFAQTitleStrategy.ts`

### 2. DefaultTitleStrategy
- **적용 대상**: 모든 URL (fallback)
- **특화 사항**: 
  - 일반적인 제목 추출 로직 (h1, title 태그, og:title 등)
  - 벤더별 특화 전략이 적용되지 않는 경우 사용
- **파일**: `DefaultTitleStrategy.ts`

## 문제 해결

### 전략이 적용되지 않는 경우

1. `canHandle` 메서드의 URL 패턴 확인
2. 브라우저 콘솔에서 로그 확인
3. `TitleStrategyManager`의 전략 등록 순서 확인

### 제목이 올바르게 추출되지 않는 경우

1. 해당 벤더의 페이지 구조 확인
2. 제목 요소의 선택자 확인
3. 동적 콘텐츠 로딩 대기 시간 조정

## 참고

- 크롤링 관련 작업 진행 시 이 문서를 참조하여 벤더별 전략을 독립적으로 관리할 것
- 새로운 벤더 추가 시 이 README를 업데이트할 것

