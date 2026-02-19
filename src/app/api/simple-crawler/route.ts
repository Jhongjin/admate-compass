/**
 * 간단한 크롤링 API
 * 공개적으로 접근 가능한 사이트들로 테스트
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls } = body;

    console.log('🕷️ 간단한 크롤링 시작:', urls);

    // 테스트용 공개 URL들 (Facebook 대신)
    const testUrls = [
      'https://httpbin.org/html',
      'https://example.com',
      'https://jsonplaceholder.typicode.com/posts/1',
      'https://httpbin.org/json',
      'https://httpbin.org/xml',
      'https://httpbin.org/robots.txt'
    ];

    const urlsToCrawl = urls.length > 0 ? urls : testUrls;
    const results = [];

    for (const url of urlsToCrawl) {
      try {
        console.log('📄 간단한 크롤링 중:', url);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache'
          },
          redirect: 'follow'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const content = await response.text();
        const title = content.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || 
                     content.match(/"title":\s*"([^"]*)"/i)?.[1] ||
                     '제목 없음';
        
        results.push({
          url,
          title: title.trim(),
          status: 'success',
          content: content.substring(0, 2000) + (content.length > 2000 ? '...' : ''),
          timestamp: new Date().toISOString(),
          contentLength: content.length
        });

        console.log('✅ 간단한 크롤링 완료:', url, `(${content.length}자)`);

      } catch (error) {
        console.error('❌ 간단한 크롤링 실패:', url, error);
        results.push({
          url,
          title: '크롤링 실패',
          status: 'failed',
          error: error instanceof Error ? error.message : '알 수 없는 오류',
          timestamp: new Date().toISOString()
        });
      }
    }

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: urlsToCrawl.length,
        success: results.filter(r => r.status === 'success').length,
        failed: results.filter(r => r.status === 'failed').length
      }
    });

  } catch (error) {
    console.error('❌ 간단한 크롤러 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '간단한 크롤링 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류'
      },
      { status: 500 }
    );
  }
}


