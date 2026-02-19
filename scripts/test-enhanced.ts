/**
 * 고도화된 크롤러 엔진 테스트 스크립트 (v03)
 */

import { CrawlerEngine } from '../src/lib/crawler-v2/core/CrawlerEngine';
import * as dotenv from 'dotenv';
import path from 'path';

// .env 로드
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testEnhancedCrawl() {
    const engine = new CrawlerEngine();

    const testUrls = [
        {
            name: 'Naver Ads FAQ (Dynamic)',
            url: 'https://ads.naver.com/help/faq/32'
        },
        {
            name: 'Meta Business Help (Mobile Fallback)',
            url: 'https://www.facebook.com/business/help/1612355132334002'
        },
        {
            name: 'Instagram Help',
            url: 'https://help.instagram.com/477434105621119'
        }
    ];

    console.log('🚀 [Verification] 고도화 크롤링 테스트 시작...\n');

    for (const test of testUrls) {
        console.log(`-----------------------------------------`);
        console.log(`📌 테스트 대상: ${test.name}`);
        console.log(`🔗 URL: ${test.url}`);

        try {
            const result = await engine.crawlUrl(test.url, {
                useCache: false, // 테스트를 위해 캐시 비활성화
                timeout: 60000
            });

            console.log(`✅ 결과 상태: ${result.status}`);
            console.log(`📄 제목: ${result.title}`);
            console.log(`📏 콘텐츠 길이: ${result.contentLength}자`);

            if (result.status === 'success') {
                console.log(`💡 콘텐츠 샘플 (MarkDown):`);
                console.log(result.content.substring(0, 300) + '...');
            } else {
                console.error(`❌ 에러: ${result.error}`);
            }
        } catch (error) {
            console.error(`❌ 실행 중 치명적 오류:`, error);
        }
        console.log(`-----------------------------------------\n`);
    }
}

testEnhancedCrawl().then(() => {
    console.log('🏁 테스트 완료');
    process.exit(0);
}).catch(err => {
    console.error('💥 테스트 실패:', err);
    process.exit(1);
});
