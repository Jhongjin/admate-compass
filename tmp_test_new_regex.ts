
import * as fs from 'fs';

async function testNewRegex() {
    const html = fs.readFileSync('naver_faq.html', 'utf8');
    console.log('🔍 [NewRegexTest] htmlData 추출 테스트...');

    // 1. htmlData 필드 추출 시도
    // JSON 구조이므로 "htmlData":"..." 형태를 찾음
    const htmlDataMatch = html.match(/"htmlData":"(.*?)"/);

    if (htmlDataMatch) {
        let content = htmlDataMatch[1];
        console.log('✅ htmlData 필드 발견!');

        // 유니코드 복원 및 HTML 태그 제거
        content = content.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        content = content.replace(/\\"/g, '"');
        const cleanContent = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        console.log('📝 Extracted Content (first 200 chars):');
        console.log(cleanContent.substring(0, 200));
    } else {
        console.log('❌ htmlData 필드 미발견. 다른 패턴 시도...');
        // 대안 패턴 (next_f push 배열 내부)
        const nextFMatch = html.match(/htmlData\\":\\"(.*?)\\"/);
        if (nextFMatch) {
            console.log('✅ htmlData (escaped) 필드 발견!');
        }
    }
}

testNewRegex().catch(console.error);
