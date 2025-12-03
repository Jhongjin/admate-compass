/**
 * 크롤러 V2 API 엔드포인트
 * 개선된 크롤링 시스템 API
 */

import { NextRequest, NextResponse } from 'next/server';
import { crawlerEngine, browserManager } from '@/lib/crawler-v2';
import type { CrawlOptions } from '@/lib/crawler-v2';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5분

/**
 * POST /api/crawler-v2/crawl
 * URL 크롤링 실행
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls, options } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: '크롤링할 URL 목록이 필요합니다.',
        },
        { status: 400 }
      );
    }

    console.log(`🕷️ 크롤러 V2 시작: ${urls.length}개 URL`);

    // 크롤링 옵션 설정
    const crawlOptions: Partial<CrawlOptions> = {
      maxDepth: options?.maxDepth || 2,
      maxUrls: options?.maxUrls || 100,
      respectRobots: options?.respectRobots !== false,
      domainLimit: options?.domainLimit !== false,
      discoverSubPages: options?.discoverSubPages || false,
      timeout: options?.timeout || 30000,
      waitTime: options?.waitTime || 1000,
      ...options,
    };

    // 크롤링 실행
    const results = await crawlerEngine.crawlUrls(urls, crawlOptions);

    // 성공/실패 통계
    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = results.filter(r => r.status === 'failed').length;

    console.log(`✅ 크롤러 V2 완료: 성공 ${successCount}개, 실패 ${failedCount}개`);

    return NextResponse.json({
      success: true,
      message: `크롤링 완료: 성공 ${successCount}개, 실패 ${failedCount}개`,
      data: {
        results,
        summary: {
          total: urls.length,
          success: successCount,
          failed: failedCount,
        },
      },
    });
  } catch (error) {
    console.error('❌ 크롤러 V2 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '크롤링 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  } finally {
    // 브라우저 정리
    try {
      await crawlerEngine.cleanup();
    } catch (error) {
      console.warn('⚠️ 브라우저 정리 실패:', error);
    }
  }
}

/**
 * GET /api/crawler-v2/crawl
 * 크롤러 상태 확인
 */
export async function GET() {
  try {
    const browser = browserManager.getBrowser();
    const isHealthy = browser ? await browserManager.isHealthy() : false;

    return NextResponse.json({
      success: true,
      data: {
        status: isHealthy ? 'ready' : 'not_initialized',
        browserInitialized: !!browser,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: '상태 확인 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

