/**
 * 페이지 제목 가져오기 API
 * URL에서 <title> 또는 <h1> 태그의 내용을 추출
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { success: false, error: 'URL이 필요합니다.' },
        { status: 400 }
      );
    }

    // fetch로 HTML 가져오기
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `HTTP ${response.status}` },
        { status: 500 }
      );
    }

    const html = await response.text();

    // 제목 추출 (우선순위: h1 > og:title > title)
    let title: string | null = null;

    // 1. <h1> 태그에서 추출
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      title = h1Match[1]
        .replace(/<[^>]*>/g, '') // HTML 태그 제거
        .replace(/\s+/g, ' ')
        .trim();
    }

    // 2. og:title에서 추출
    if (!title) {
      const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i) ||
                           html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["']/i);
      if (ogTitleMatch) {
        title = ogTitleMatch[1].trim();
      }
    }

    // 3. <title> 태그에서 추출
    if (!title) {
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (titleMatch) {
        title = titleMatch[1]
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }

    // 제목 정리 (사이트 이름 제거 등)
    if (title) {
      // "제목 - 사이트명" 또는 "제목 | 사이트명" 형식에서 사이트명 제거
      const separators = [' - ', ' | ', ' – ', ' — ', ' :: '];
      for (const sep of separators) {
        if (title.includes(sep)) {
          const parts = title.split(sep);
          // 첫 번째 부분이 더 길면 그것을 제목으로 사용
          if (parts[0].length > 10) {
            title = parts[0].trim();
            break;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      title: title || null,
      url,
    });
  } catch (error) {
    console.error('페이지 제목 가져오기 오류:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' },
      { status: 500 }
    );
  }
}

