/**
 * 제목 추출 전략 관리자
 * 벤더별 제목 추출 전략을 등록하고 적절한 전략을 선택
 * 
 * 사용법:
 * 1. 새로운 벤더 전략 추가 시 이 파일에 전략을 등록
 * 2. 각 벤더별 전략은 독립적으로 관리되므로 기존 전략에 영향을 주지 않음
 */

import { Page } from 'puppeteer-core';
import { TitleExtractionStrategy, TitleExtractionResult } from './TitleExtractionStrategy';
import { NaverAdsFAQTitleStrategy } from './NaverAdsFAQTitleStrategy';
import { MetaHelpTitleStrategy } from './MetaHelpTitleStrategy';
import { DefaultTitleStrategy } from './DefaultTitleStrategy';


export class TitleStrategyManager {
  private strategies: TitleExtractionStrategy[] = [];

  constructor() {
    // 벤더별 전략 등록 (우선순위 순서대로)
    // 먼저 등록된 전략이 우선적으로 적용됨

    // 1. Naver Ads FAQ 전략 (가장 구체적인 전략)
    this.strategies.push(new NaverAdsFAQTitleStrategy());

    // 2. Meta Help 전략
    this.strategies.push(new MetaHelpTitleStrategy());


    // TODO: 다른 벤더별 전략 추가 시 여기에 등록
    // 예: this.strategies.push(new MetaHelpTitleStrategy());
    // 예: this.strategies.push(new GoogleSupportTitleStrategy());
    // 예: this.strategies.push(new KakaoGuideTitleStrategy());

    // 2. 기본 전략 (항상 마지막에 등록 - fallback)
    this.strategies.push(new DefaultTitleStrategy());
  }

  /**
   * URL과 페이지에 적합한 전략을 찾아 제목 추출
   * @param url 크롤링 대상 URL
   * @param page Puppeteer Page 객체
   * @returns 제목 추출 결과
   */
  async extractTitle(url: string, page: Page): Promise<TitleExtractionResult> {
    // 등록된 전략을 순서대로 확인하여 적용 가능한 첫 번째 전략 사용
    for (const strategy of this.strategies) {
      const canHandle = await strategy.canHandle(url, page);
      if (canHandle) {
        console.log(`📌 [TitleStrategy] ${strategy.getVendorType()} 전략 적용: ${url}`);
        try {
          const result = await strategy.extractTitle(url, page);
          if (result.title) {
            return result;
          }
          // 전략이 적용되었지만 제목을 찾지 못한 경우, 다음 전략으로 fallback하지 않고 null 반환
          // (전략이 명시적으로 null을 반환한 것은 해당 전략이 적합하지 않다는 의미일 수 있음)
          // 하지만 일단은 null을 반환하고 ContentExtractor에서 일반 로직으로 fallback
          return result;
        } catch (error) {
          console.error(`❌ [TitleStrategy] ${strategy.getVendorType()} 전략 실행 오류:`, error);
          // 오류 발생 시 다음 전략으로 fallback
          continue;
        }
      }
    }

    // 모든 전략이 실패한 경우 (이론적으로는 발생하지 않아야 함 - DefaultTitleStrategy가 항상 true 반환)
    console.warn(`⚠️ [TitleStrategy] 적용 가능한 전략을 찾을 수 없음: ${url}`);
    return {
      title: null,
      source: 'no-strategy-found'
    };
  }

  /**
   * 새로운 전략 등록 (런타임에 동적으로 추가 가능)
   * @param strategy 제목 추출 전략
   * @param priority 우선순위 (낮을수록 먼저 적용, 기본값: strategies.length)
   */
  registerStrategy(strategy: TitleExtractionStrategy, priority?: number): void {
    if (priority !== undefined) {
      this.strategies.splice(priority, 0, strategy);
    } else {
      // 기본 전략 바로 앞에 추가
      this.strategies.splice(this.strategies.length - 1, 0, strategy);
    }
    console.log(`✅ [TitleStrategy] ${strategy.getVendorType()} 전략 등록됨`);
  }
}

// 싱글톤 인스턴스 (전역에서 공유)
export const titleStrategyManager = new TitleStrategyManager();

