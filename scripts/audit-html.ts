
import fetch from 'node-fetch';
import fs from 'fs';

async function auditHtml() {
    const url = 'https://ads.naver.com/help/faq/989';
    console.log(`🌐 Auditing: ${url}`);

    const resp = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    const text = await resp.text();
    fs.writeFileSync('faq_989.html', text);
    console.log(`✅ Saved HTML to faq_989.html (${text.length} bytes)`);

    // Check for common FAQ keywords
    const hasFaq = text.includes('faq_') || text.includes('content') || text.includes('question');
    console.log(`Has FAQ keywords: ${hasFaq}`);
}

auditHtml();
