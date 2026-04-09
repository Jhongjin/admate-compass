
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testNaverFetch() {
    const url = 'https://ads.naver.com/help/faq/726';
    console.log(`🌐 [FetchTest] ${url} 직접 요청 중...`);

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            }
        });

        console.log(`📊 Response OK: ${response.ok}, Status: ${response.status}`);

        const html = await response.text();
        console.log(`📊 Response Length: ${html.length}`);

        // CrawlerEngine 로직: SE-TEXT 마커
        const seTextMatch = html.match(/SE-TEXT \{ --\\u003e([\s\S]*?)\\u003c!-- \} SE-TEXT/g);
        if (seTextMatch) {
            console.log(` ✅ SE-TEXT 발견! (${seTextMatch.length}개)`);
        } else {
            console.log(' ❌ SE-TEXT 미발견. 다른 정규식 시도...');
            // 이스케이프가 다를 수 있음
            const seTextMatch2 = html.match(/SE-TEXT \{ --u003e([\s\S]*?)u003c-- \} SE-TEXT/g);
            if (seTextMatch2) console.log(' ✅ SE-TEXT (v2) 발견!');
        }

        const jsonContentMatch = html.match(/"content":"(.*?)"/);
        if (jsonContentMatch) console.log(' ✅ JSON content 필드 발견!');

        console.log('📝 HTML Snippet (Sample):');
        console.log(html.substring(Math.max(0, html.indexOf('SE-TEXT') - 100), html.indexOf('SE-TEXT') + 200));

    } catch (error) {
        console.error('❌ Fetch 실패:', error);
    }
}

testNaverFetch().catch(console.error);
