/**
 * 테스트용 크롤링 API
 * 간단한 URL 크롤링 테스트
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls } = body;

    console.log('🧪 테스트 크롤링 시작:', urls);

    const results = [];

    for (const url of urls) {
      try {
        console.log('📄 테스트 크롤링 중:', url);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0'
          },
          redirect: 'follow'
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText.substring(0, 200)}`);
        }

        const html = await response.text();
        const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '제목 없음';
        
        results.push({
          url,
          title,
          status: 'success',
          content: html.substring(0, 1000) + '...',
          timestamp: new Date().toISOString()
        });

        console.log('✅ 테스트 크롤링 완료:', url);

      } catch (error) {
        console.error('❌ 테스트 크롤링 실패:', url, error);
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
        total: urls.length,
        success: results.filter(r => r.status === 'success').length,
        failed: results.filter(r => r.status === 'failed').length
      }
    });

  } catch (error) {
    console.error('❌ 테스트 크롤러 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '테스트 크롤링 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류'
      },
      { status: 500 }
    );
  }
}
