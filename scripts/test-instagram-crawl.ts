import { CrawlerEngine } from '../src/lib/crawler-v2/core/CrawlerEngine';
import * as fs from 'fs';
import * as path from 'path';

async function run() {
    const engine = new CrawlerEngine({ headless: true });
    const url = 'https://help.instagram.com/479832029758079/';

    console.log(`크롤링 시작: ${url}`);
    try {
        const result = await engine.crawl(url);
        const outputPath = path.join(__dirname, '../tmp/instagram_extract.md');
        fs.mkdirSync(path.join(__dirname, '../tmp'), { recursive: true });

        let content = `# ${result.title}\n\n${result.content}`;
        fs.writeFileSync(outputPath, content);

        console.log(`✅ 결과가 저장되었습니다: ${outputPath}`);
        console.log(`- 추출된 글자 수: ${result.content.length}`);
    } catch (err) {
        console.error(`❌ 크롤링 실패:`, err);
    } finally {
        process.exit(0);
    }
}

run();
