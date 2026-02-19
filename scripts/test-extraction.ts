/**
 * 추출 로직 테스트 스크립트
 */

import { ContentExtractor } from '../src/lib/crawler-v2/core/ContentExtractor';
import { Page } from 'puppeteer-core';

// Mock Page 객체 생성
const mockPage = {
    content: async () => `
    <html>
      <head><title>테스트 페이지</title></head>
      <body>
        <div class="header_area">네비게이션 바</div>
        <main>
          <h1 class="content_title">네이버 성과형 디스플레이 광고 도움말</h1>
          <div class="content">
            <p>본문 내용입니다. 광고 설정 방법은 다음과 같습니다.</p>
            <button>자세히 알아보기</button>
            <a href="#">상품 더 알아보기</a>
          </div>
        </main>
        <footer class="footer_area">푸터 정보</footer>
      </body>
    </html>
  `,
    evaluate: async (fn: any, ...args: any[]) => {
        // 간단한 evaluate mock (실제 브라우저 환경은 아니지만 로직 테스트 가능)
        if (typeof fn === 'function') {
            // 이 부분은 실제 puppeteer 환경이 아니면 한계가 있음
            // 하지만 ContentExtractor의 로직 대부분은 전달된 HTML이나 page의 다른 메서드를 사용함
            return null;
        }
        return null;
    },
    waitForFunction: async () => true,
    waitForSelector: async () => true,
} as unknown as Page;

async function testExtraction() {
    console.log('🧪 추출 로직 테스트 시작...');

    const extractor = new ContentExtractor();
    const url = 'https://ads.naver.com/help/faq/123';

    try {
        // 실제 ContentExtractor.extractFromPage는 page.content()를 사용함
        // 여기서는 mockPage가 이미 정해진 HTML을 반환하도록 설정됨

        const result = await extractor.extractFromPage(mockPage, url);

        console.log('\n✅ 추출 결과:');
        console.log('제목:', result.title);
        console.log('본문 길이:', result.content.length);
        console.log('--- 본문 내용 ---');
        console.log(result.content);
        console.log('-----------------');

        // 검증
        const hasBoilerplate = result.content.includes('자세히 알아보기') || result.content.includes('상품 더 알아보기');
        const hasLayout = result.content.includes('네비게이션 바') || result.content.includes('푸터 정보');

        if (hasBoilerplate) console.error('❌ 오류: 본문에 보일러플레이트가 포함되어 있습니다.');
        else console.log('✅ 성공: 보일러플레이트가 제거되었습니다.');

        if (hasLayout) console.error('❌ 오류: 본문에 레이아웃 요소가 포함되어 있습니다.');
        else console.log('✅ 성공: 레이아웃 요소가 제거되었습니다.');

    } catch (error) {
        console.error('❌ 테스트 중 오류 발생:', error);
    }
}

testExtraction().catch(console.error);
