/**
 * Meta Help 페이지 제목 추출 전략
 * 
 * 특화 사항:
 * - Meta Help (Facebook, Instagram) 페이지의 제목 추출
 * - h1 태그 및 Meta 특유의 클래스/데이터 속성 활용
 * - 모바일 환경 리다이렉트 고려
 * 
 * 적용 대상:
 * - facebook.com/business/help/*
 * - facebook.com/help/*
 * - instagram.com/help/*
 */

import { Page } from 'puppeteer-core';
import { TitleExtractionStrategy, TitleExtractionResult } from './TitleExtractionStrategy';

export class MetaHelpTitleStrategy implements TitleExtractionStrategy {
    getVendorType(): string {
        return 'META';
    }

    async canHandle(url: string, page: Page): Promise<boolean> {
        const isMeta = url.includes('facebook.com') || url.includes('instagram.com');
        const isHelp = url.includes('/help/') || url.includes('/business/help/');
        return isMeta && isHelp;
    }

    async extractTitle(url: string, page: Page): Promise<TitleExtractionResult> {
        console.log(`🔍 [MetaHelp] 제목 추출 시작... URL: ${url}`);

        // 메인 콘텐츠 영역 대기
        try {
            await page.waitForSelector('h1, [role="main"] h1, article h1', { timeout: 10000 });
        } catch (e) {
            console.warn(`⚠️ [MetaHelp] 제목 요소 대기 타임아웃: ${url}`);
        }

        const result = await page.evaluate(() => {
            // 1. h1 태그 (가장 표준)
            const h1 = document.querySelector('h1');
            if (h1 && h1.textContent?.trim()) {
                return { title: h1.textContent.trim(), source: 'h1' };
            }

            // 2. Meta 특유의 클래스/ID (도움말 센터 제목)
            const metaTitleSelectors = [
                '[data-testid="help_center_article_title"]',
                '.help_center_title',
                '#help_center_title',
                'h2.uiHeaderTitle'
            ];

            for (const selector of metaTitleSelectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent?.trim()) {
                    return { title: el.textContent.trim(), source: `meta-selector-${selector}` };
                }
            }

            // 3. og:title 메타 태그
            const ogTitle = document.querySelector('meta[property="og:title"]');
            if (ogTitle) {
                const content = ogTitle.getAttribute('content');
                if (content && content.trim()) {
                    return { title: content.trim(), source: 'og:title' };
                }
            }

            return { title: null, source: 'failed' };
        });

        if (result.title) {
            console.log(`✅ [MetaHelp] 제목 추출 성공: "${result.title}" (출처: ${result.source})`);
        }

        return {
            title: result.title,
            source: `meta-help-${result.source}`
        };
    }
}
