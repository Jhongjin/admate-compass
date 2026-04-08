
import cheerio from 'cheerio';
import fetch from 'node-fetch';

async function testNaverRscExtraction() {
  const targetUrl = 'https://ads.naver.com/help/faq/726';
  console.log(`🚀 [Test] "${targetUrl}" 에서 RSC 본문 추출 테스트 시작...`);

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const htmlContent = await response.text();
    console.log(`📡 HTML 가져오기 성공: ${htmlContent.length}자`);

    // 1. 기존 방식 (Cheerio만)
    const $ = cheerio.load(htmlContent);
    let oldText = $('main').text() || $('body').text();
    console.log(`❌ 기존 방식 추출 길이: ${oldText.trim().length}자`);

    // 2. 패치된 RSC 대응 방식
    let textContent = "";
    const htmlDataMatch = htmlContent.match(/"htmlData"\s*:\s*"((?:\\"|[^"])*)"/);
    if (htmlDataMatch && htmlDataMatch[1]) {
      console.log('✅ "htmlData" 필드 발견!');
      const decodedHtml = htmlDataMatch[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\');

      const $htmlData = cheerio.load(decodedHtml);
      textContent = $htmlData.text();
      console.log(`✅ [SUCCESS] RSC 내부 텍스트 추출 성공: ${textContent.length}자`);
      console.log('📝 추출 내용 일부:', textContent.substring(0, 300));
    } else {
      console.log('❌ "htmlData" 필드를 찾지 못했습니다.');
    }

  } catch (e) {
    console.error('❌ 테스트 중 에러:', e);
  }
}

testNaverRscExtraction();
