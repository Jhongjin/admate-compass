/**
 * Puppeteer 크롤러 API
 * URL 크롤링 및 하위 페이지 추출 기능
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls, options = {} } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: '유효한 URL 배열이 필요합니다.' },
        { status: 400 }
      );
    }

    console.log('🕷️ 크롤링 시작:', urls.length, '개 URL');

    const results = [];
    const errors = [];

    for (const url of urls) {
      try {
        console.log('📄 크롤링 중:', url);
        
        // 간단한 fetch 기반 크롤링 (Puppeteer 대신)
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();
        
        // 간단한 텍스트 추출 (실제로는 cheerio 등 사용)
        const textContent = extractTextFromHTML(html);
        
        results.push({
          url,
          title: extractTitle(html),
          content: textContent,
          status: 'success',
          timestamp: new Date().toISOString()
        });

        console.log('✅ 크롤링 완료:', url);

      } catch (error) {
        console.error('❌ 크롤링 실패:', url, error);
        errors.push({
          url,
          error: error instanceof Error ? error.message : '알 수 없는 오류',
          status: 'failed',
          timestamp: new Date().toISOString()
        });
      }
    }

    return NextResponse.json({
      success: true,
      results,
      errors,
      summary: {
        total: urls.length,
        success: results.length,
        failed: errors.length
      }
    });

  } catch (error) {
    console.error('❌ 크롤러 API 오류:', error);
    return NextResponse.json(
      { 
        error: '크롤링 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류'
      },
      { status: 500 }
    );
  }
}

// HTML에서 텍스트 추출
function extractTextFromHTML(html: string): string {
  // 간단한 HTML 태그 제거
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 특수 문자 정리
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  return text;
}

// HTML에서 제목 추출
function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].trim();
  }
  
  const h1Match = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  if (h1Match) {
    return h1Match[1].trim();
  }
  
  return '제목 없음';
}


