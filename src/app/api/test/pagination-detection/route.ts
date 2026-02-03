/**
 * Pagination 감지 테스트 API
 * Phase 1: Pagination 감지 기능 테스트용
 */

import { NextRequest, NextResponse } from 'next/server';
import { browserManager } from '@/lib/crawler-v2/core/BrowserManager';
import { detectPagination, generatePageUrls } from '@/lib/crawler-v2/utils/pagination-utils';
import { naverAdsPaginationStrategy } from '@/lib/crawler-v2/strategies/NaverAdsPaginationStrategy';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL이 필요합니다' },
        { status: 400 }
      );
    }

    console.log(`🧪 [Pagination Test] 시작: ${url}`);

    // 브라우저 초기화
    await browserManager.initialize();
    const page = await browserManager.createPage();

    try {
      // 페이지 로드
      console.log(`🧪 [Pagination Test] 페이지 로드 중...`);
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // 페이지 안정화 대기
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Naver Ads FAQ 페이지인 경우 특화 전략 사용
      let result;
      if (naverAdsPaginationStrategy.canHandle(url)) {
        console.log(`🧪 [Pagination Test] Naver Ads FAQ 특화 전략 사용`);
        result = await naverAdsPaginationStrategy.detectPagination(page, url);
      } else {
        console.log(`🧪 [Pagination Test] 기본 pagination 감지 사용`);
        result = await detectPagination(page, url);
      }

      // 페이지 닫기
      await page.close();

      return NextResponse.json({
        success: true,
        url,
        result,
        // URL 생성 테스트 (감지 성공 시)
        generatedUrls: result.pagination
          ? generatePageUrls(result.pagination)
          : [],
      });
    } catch (error) {
      await page.close();
      throw error;
    }
  } catch (error) {
    console.error(`❌ [Pagination Test] 실패:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}


