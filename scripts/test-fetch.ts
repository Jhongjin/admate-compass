
import fetch from 'node-fetch';

async function testFetch() {
    const urls = [
        'https://ads.naver.com/help/faq/989',
        'https://ads.naver.com/help/faq/714'
    ];

    for (const url of urls) {
        console.log(`\n🌐 Fetching: ${url}`);
        try {
            const resp = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            console.log(`HTTP Status: ${resp.status}`);
            const text = await resp.text();
            console.log(`Content Length: ${text.length}`);

            // 본문 추출 시도 (CrawlerEngine.ts 로직 모사)
            const titleMatch = text.match(/<title>(.*?)<\/title>/i);
            const contentMatch = text.match(/<div class="faq_content">(.*?)<\/div>/s) ||
                text.match(/"content":"(.*?)"/);

            console.log(`Title: ${titleMatch ? titleMatch[1] : 'NOT FOUND'}`);
            console.log(`Content Sample: ${contentMatch ? contentMatch[1].substring(0, 100) : 'NOT FOUND'}`);
        } catch (e) {
            console.error(`❌ Fetch Failed: ${e}`);
        }
    }
}

testFetch();
