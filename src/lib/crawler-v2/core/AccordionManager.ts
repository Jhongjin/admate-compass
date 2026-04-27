import { Page } from 'puppeteer-core';
import { logger } from '../../utils/logger';

export interface AccordionConfig {
    selectors: string[];
    expandWaitTime: number;
    maxClicks: number;
}

export class AccordionManager {
    private defaultConfig: AccordionConfig = {
        selectors: [
            'button[aria-expanded="false"]',
            '[role="button"][aria-expanded="false"]',
            'summary',
            '[class*="accordion"] [class*="toggle"]',
            '[class*="chevron"]', // common icon pattern
        ],
        expandWaitTime: 500, // 0.5s wait after click
        maxClicks: 100, // safety limit
    };

    /**
     * 페이지 내의 모든 아코디언을 확장합니다.
     */
    async expandAll(page: Page, options: Partial<AccordionConfig> = {}): Promise<number> {
        const config = { ...this.defaultConfig, ...options };
        const url = page.url();
        let totalExpanded = 0;
        const clickedElementIds = new Set<string>();

        logger.log(`[AccordionManager] 아코디언 확장 시작: ${url}`);

        try {
            let hasMoreToExpand = true;
            let iteration = 0;

            while (hasMoreToExpand && iteration < config.maxClicks) {
                iteration++;

                // 확장 가능한 요소 찾기
                const expandCandidate = await page.evaluate((selectors) => {
                    for (const selector of selectors) {
                        const elements = Array.from(document.querySelectorAll(selector));
                        // 실제로 보이고(visible) 아직 확장되지 않은 요소 찾기
                        const candidate = elements.find(el => {
                            // aria-expanded 체크
                            const isExpanded = el.getAttribute('aria-expanded');
                            if (isExpanded === 'true') return false;

                            // details/summary 체크
                            if (el.tagName.toLowerCase() === 'summary') {
                                const details = el.parentElement;
                                if (details && details.tagName.toLowerCase() === 'details' && details.hasAttribute('open')) {
                                    return false;
                                }
                            }

                            // 가시성 체크
                            const style = window.getComputedStyle(el);
                            if (style.display === 'none' || style.visibility === 'hidden') return false;

                            const rect = el.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0;
                        });

                        if (candidate) {
                            // 요소의 고유 식별자(텍스트 또는 경로) 반환
                            return {
                                selector,
                                text: candidate.textContent?.trim().substring(0, 30) || 'no-text',
                                index: elements.indexOf(candidate)
                            };
                        }
                    }
                    return null;
                }, config.selectors);

                if (!expandCandidate) {
                    hasMoreToExpand = false;
                    break;
                }

                const elementId = `${expandCandidate.selector}-${expandCandidate.text}-${expandCandidate.index}`;
                if (clickedElementIds.has(elementId)) {
                    // 이미 클릭을 시도한 요소라면 루프 중단 (무한 루프 방지)
                    hasMoreToExpand = false;
                    break;
                }

                clickedElementIds.add(elementId);

                // 클릭 수행
                try {
                    const elements = await page.$$(expandCandidate.selector);
                    const targetElement = elements[expandCandidate.index];
                    if (targetElement) {
                        // 헤더 텍스트 보존을 위해 속성 추가 또는 태그 변경 유도
                        await page.evaluate((el) => {
                            // 아코디언 헤더임을 표시
                            el.setAttribute('data-rag-section-header', 'true');
                            // 가독성을 위해 클래스 추가
                            el.classList.add('rag-expanded-header');

                            // 만약 단순 div라면 시각적으로는 유지하되 검색엔진이 헤더로 인식하게 role 추가
                            if (el.tagName.toLowerCase() === 'div' || el.tagName.toLowerCase() === 'button') {
                                el.setAttribute('role', 'heading');
                                el.setAttribute('aria-level', '3');
                            }
                        }, targetElement);

                        await targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        await targetElement.click();
                        totalExpanded++;

                        // 콘텐츠 로딩 대기
                        await new Promise(resolve => setTimeout(resolve, config.expandWaitTime));
                    }
                } catch (clickError) {
                    logger.warn(`[AccordionManager] 클릭 실패: ${expandCandidate.text}`, clickError);
                }
            }

            if (totalExpanded > 0) {
                logger.log(`[AccordionManager] 총 ${totalExpanded}개의 아코디언 확장 완료: ${url}`);
            }

            return totalExpanded;
        } catch (error) {
            logger.error(`[AccordionManager] 아코디언 확장 중 오류 발생: ${url}`, error);
            return totalExpanded;
        }
    }

    /**
     * 도메인에 따라 아코디언 확장이 필요한지 판단합니다.
     */
    shouldExpand(url: string): boolean {
        const lowerUrl = url.toLowerCase();
        return (
            lowerUrl.includes('facebook.com/business/help') ||
            lowerUrl.includes('www.facebook.com/help') ||
            lowerUrl.includes('help.instagram.com') ||
            lowerUrl.includes('meta.com/help')
        );
    }
}

export const accordionManager = new AccordionManager();
