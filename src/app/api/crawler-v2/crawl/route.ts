/**
 * 크롤러 V2 API 엔드포인트 (개선 버전)
 * 개선된 크롤링 시스템 API
 * 
 * 개선 사항:
 * - 상세한 진행률 정보 전송
 * - 메모리 모니터링 정보 포함
 * - 캐시 히트율 정보 포함
 */

import { NextRequest, NextResponse } from 'next/server';
import { crawlerEngine, browserManager } from '@/lib/crawler-v2';
import type { CrawlOptions, CrawlProgress } from '@/lib/crawler-v2';

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
        { success: false, error: '크롤링할 URL 목록이 필요합니다.' },
        { status: 400 }
      );
    }

    console.log(`🕷️ 크롤러 V2 시작: ${urls.length}개 URL`);

    const crawlOptions: Partial<CrawlOptions> = {
      maxDepth: options?.maxDepth || 2,
      maxUrls: options?.maxUrls || 100,
      respectRobots: options?.respectRobots !== false,
      domainLimit: options?.domainLimit !== false,
      discoverSubPages: options?.discoverSubPages || false,
      timeout: options?.timeout || 30000,
      waitTime: options?.waitTime || 1000,
      useCache: options?.useCache !== false, // 기본값: true
      cacheTTL: options?.cacheTTL || 24 * 60 * 60, // 24시간
      maxRetries: options?.maxRetries || 3,
      retryDelay: options?.retryDelay || 1000,
      concurrency: options?.concurrency || 3, // 기본값: 3개 병렬 처리
      enableMemoryMonitoring: options?.enableMemoryMonitoring !== false, // 기본값: true
      ...options,
    };

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Run crawling in background
    (async () => {
      try {
        const results = await crawlerEngine.crawlUrls(urls, crawlOptions, (progress) => {
          // 진행률 정보 전송
          if (progress.type === 'progress' && progress.progress) {
            writer.write(
              encoder.encode(
                JSON.stringify({
                  type: 'progress',
                  ...progress.progress,
                }) + '\n'
              )
            );
          }

          // 로그 메시지 전송
          if (progress.type === 'log') {
            writer.write(
              encoder.encode(
                JSON.stringify({
                  type: 'log',
                  message: progress.message,
                  current: progress.current,
                  total: progress.total,
                }) + '\n'
              )
            );
          }

          // 배치 진행 상황 전송
          if (progress.type === 'batch_progress') {
            writer.write(
              encoder.encode(
                JSON.stringify({
                  type: 'batch_progress',
                  message: progress.message,
                  current: progress.current,
                  total: progress.total,
                  result: progress.result,
                }) + '\n'
              )
            );
          }
        });

        // 최종 완료 정보
        const successCount = results.filter((r) => r.status === 'success').length;
        const failedCount = results.filter((r) => r.status === 'failed').length;

        // 통계 정보 가져오기
        const stats = crawlerEngine.getStats();

        writer.write(
          encoder.encode(
            JSON.stringify({
              type: 'done',
              success: true,
              summary: {
                total: urls.length,
                success: successCount,
                failed: failedCount,
              },
              stats: {
                cacheHitRate: stats.cacheHitRate.toFixed(2) + '%',
                averageProcessingTime: stats.averageProcessingTime.toFixed(2) + '초',
                memoryStats: stats.memoryStats,
              },
              results: results,
            }) + '\n'
          )
        );
      } catch (error) {
        console.error('❌ 크롤러 V2 API 오류:', error);
        writer.write(
          encoder.encode(
            JSON.stringify({
              type: 'error',
              error: error instanceof Error ? error.message : String(error),
            }) + '\n'
          )
        );
      } finally {
        try {
          await crawlerEngine.cleanup();
          await writer.close();
        } catch (e) {
          console.warn('Stream cleanup error:', e);
        }
      }
    })();

    return new NextResponse(stream.readable, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('❌ 크롤러 V2 API 요청 오류:', error);
    return NextResponse.json(
      { success: false, error: '요청 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
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

    // 통계 정보 포함
    const stats = crawlerEngine.getStats();

    return NextResponse.json({
      success: true,
      data: {
        status: isHealthy ? 'ready' : 'not_initialized',
        browserInitialized: !!browser,
        stats: {
          cacheHitRate: stats.cacheHitRate.toFixed(2) + '%',
          averageProcessingTime: stats.averageProcessingTime.toFixed(2) + '초',
          memoryStats: stats.memoryStats,
        },
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
