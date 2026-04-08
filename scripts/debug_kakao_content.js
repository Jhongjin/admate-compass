const cheerio = require('cheerio');
// node-fetch v3 is ESM, using global fetch supported in Node 18+

async function debugKakao() {
    const url = 'https://kakaobusiness.gitbook.io/main/ad/info';
    console.log('Fetching:', url);

    const commonHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    };

    try {
        const response = await fetch(url, { headers: commonHeaders });
        if (!response.ok) {
            console.error('HTTP Error:', response.status);
            return;
        }

        const html = await response.text();
        console.log('HTML Length:', html.length);

        const $ = cheerio.load(html);

        // Check if it's a GitBook page and what the structure looks like
        console.log('Title:', $('title').text());
        console.log('Body Text Length (Cheerio):', $('body').text().length);

        // Look for main content selectors used in route.ts
        const contentSelectors = ['main', 'article', '.content', '.main-content', '#content'];
        for (const selector of contentSelectors) {
            const content = $(selector).text().trim();
            console.log(`Selector "${selector}" content length:`, content.length);
            if (content.length > 0) {
                console.log(`Preview (${selector}):`, content.substring(0, 200));
            }
        }

        // Check for empty root indicator
        const hasEmptyRoot = $('#root, #app').length > 0 && $('#root, #app').text().trim().length < 100;
        console.log('Has Empty Root (#root/#app):', hasEmptyRoot);

    } catch (error) {
        console.error('Error:', error);
    }
}

debugKakao();
