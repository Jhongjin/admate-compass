
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function saveNaverHtml() {
    const url = 'https://ads.naver.com/help/faq/726';
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        }
    });

    const html = await response.text();
    fs.writeFileSync('naver_faq.html', html, 'utf8');
    console.log(`✅ naver_faq.html 저장 완료 (${html.length} bytes)`);
}

saveNaverHtml().catch(console.error);
