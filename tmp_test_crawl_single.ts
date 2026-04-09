
import { CrawlerEngine } from './src/lib/crawler-v2/core/CrawlerEngine';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testCrawl() {
    const engine = new CrawlerEngine();
    const url = 'https://ads.naver.com/help/faq/726';

    console.log(`🚀 [TestCrawl] ${url} 크롤링 테스트 시작...`);

    const result = await engine.crawlUrl(url, {
        useCache: false, // 테스트이므로 캐시 미사용
        timeout: 60000,
        waitTime: 3000
    });

    console.log('📊 Result Status:', result.status);
    console.log('📊 Title:', result.title);
    console.log('📊 Content Length:', result.contentLength);
    console.log('📊 Error:', result.error);

    if (result.content) {
        console.log('📝 Content Snippet (100자):');
        console.log(result.content.substring(0, 100));
    }
}

testCrawl().catch(console.error);
