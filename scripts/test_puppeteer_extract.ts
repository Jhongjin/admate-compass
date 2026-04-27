import puppeteer from 'puppeteer-core';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function run() {
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    const url = 'https://help.instagram.com/479832029758079/';

    console.log(`Loading ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2' });

    // AccordionManager.expandAll 시뮬레이션
    console.log('Expanding accordions...');
    const expandedCount = await page.evaluate(async () => {
        let count = 0;
        const buttons = document.querySelectorAll('div[role="button"][aria-expanded="false"]');
        for (const btn of Array.from(buttons)) {
            if (
                btn.querySelector('[data-bloks-name="bk.components.Icon"]') ||
                window.getComputedStyle(btn).cursor === 'pointer'
            ) {
                (btn as HTMLElement).click();
                await new Promise(r => setTimeout(r, 200));
                count++;
            }
        }
        return count;
    });
    console.log(`Expanded ${expandedCount} accordions.`);

    // 대기
    await new Promise(r => setTimeout(r, 1000));

    // extractContent 파트
    const selectors = ['main', 'article', '.content', '.main-content', '[role="main"]', '.page-content'];
    const removeSelectors = [
        'script', 'style', 'nav', 'footer', 'header', 'aside',
        '.nav_area', '.header_area', '.footer_area', '.aside_area',
        '.sidebar', '.gnb', '.lnb', '.footer', '.header',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        '.u_skip', '#header', '#footer', '#gnb', '.quick_menu',
        '.category_area', '.banner_area', '.ad_area', '.promotion_area'
    ];

    const contentHtml = await page.evaluate((selectors, removeSelectors) => {
        const elementsToRemove = document.querySelectorAll(removeSelectors.join(','));
        elementsToRemove.forEach(el => el.remove());

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                return element.innerHTML || '';
            }
        }
        return document.body?.innerHTML || '';
    }, selectors, removeSelectors);

    const outputPath = path.join(__dirname, '../tmp/instagram_extracted_raw.html');
    fs.writeFileSync(outputPath, contentHtml);
    console.log(`Saved raw HTML to ${outputPath}. Length: ${contentHtml.length}`);

    await browser.close();
}

run();
