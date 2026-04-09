
import fetch from 'node-fetch';
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

        if (!response.ok) {
            console.error(`❌ HTTP Error: ${response.status} ${response.statusText}`);
            return;
        }

        const html = await response.text();
        console.log(`📊 Response Length: ${html.length}`);

        // 1. SE-TEXT 마커 확인 (CrawlerEngine 로직)
        const seTextMatch = html.match(/SE-TEXT \{ --\\u003e([\s\S]*?)\\u003c!-- \} SE-TEXT/g);
        if (seTextMatch) {
            console.log(`✅ SE-TEXT 마커 발견! (${seTextMatch.length}개)`);
            const content = seTextMatch.map(m => m.replace(/\\u[0-9a-fA-F]{4}/g, (match) => {
                return String.fromCharCode(parseInt(match.replace('\\u', ''), 16));
            }).replace(/<[^>]+>/g, ' ')).join('\n');
            console.log('📝 Extracted Content (first 200 chars):');
            console.log(content.substring(0, 200));
        } else {
            console.log('❌ SE-TEXT 마커를 찾을 수 없습니다.');

            // 2. 다른 텍스트 필드 확인
            const jsonContentMatch = html.match(/\\"content\\":\\"(.*?)\\"/);
            if (jsonContentMatch) {
                console.log('✅ JSON content 필드 발견!');
            } else {
                console.log('❌ JSON content 필드도 찾을 수 없습니다.');
                // HTML의 일부 출력
                console.log('📝 HTML Head Snippet:');
                console.log(html.substring(0, 500));
            }
        }

    } catch (error) {
        console.error('❌ Fetch 실패:', error);
    }
}

testNaverFetch().catch(console.error);
