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
export const maxDuration = 800; // 13.3분 (Vercel Pro 플랜 최대값, Pagination 모드에서 많은 URL 크롤링 시 필요)

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
    const rawMaxDepth = options?.maxDepth as unknown;
    const isMaxDepthMode =
      rawMaxDepth === 'MAX' ||
      options?.depthMode === 'MAX';

    const parsedMaxDepth =
      typeof rawMaxDepth === 'number'
        ? rawMaxDepth
        : typeof rawMaxDepth === 'string'
          ? Number.parseInt(rawMaxDepth, 10)
          : undefined;

    // Pagination 모드 확인
    const paginationMode = options?.paginationMode === true;

    const crawlOptions: Partial<CrawlOptions> = {
      maxDepth: isMaxDepthMode ? undefined : (Number.isFinite(parsedMaxDepth) ? parsedMaxDepth : 2),
      depthMode: isMaxDepthMode ? 'MAX' : (options?.depthMode || 'LIMITED'),
      maxUrls: paginationMode ? 10000 : (options?.maxUrls || 100), // Pagination 모드에서는 충분히 큰 값으로 설정
      respectRobots: options?.respectRobots !== false,
      domainLimit: options?.domainLimit !== false,
      discoverSubPages: paginationMode ? false : (options?.discoverSubPages || false), // Pagination 모드에서는 하위 페이지 발견 비활성화
      timeout: options?.timeout || 30000,
      waitTime: options?.waitTime || 1000,
      useCache: options?.useCache !== false, // 기본값: true
      cacheTTL: options?.cacheTTL || 24 * 60 * 60, // 24시간
      maxRetries: options?.maxRetries || 3,
      retryDelay: options?.retryDelay || 1000,
      concurrency: options?.concurrency || 3, // 기본값: 3개 병렬 처리
      enableMemoryMonitoring: options?.enableMemoryMonitoring !== false, // 기본값: true
      // MAX 모드일 때 재귀 탐색 활성화 (discoverSubPages가 true일 때만 의미 있음)
      recursiveDiscovery: isMaxDepthMode ? true : options?.recursiveDiscovery,
      // MAX 모드 기본 상한 (무한루프/폭발 방지). 옵션으로 덮어쓸 수 있음.
      maxRecursivePages: options?.maxRecursivePages || (isMaxDepthMode ? 120 : undefined),
      // MAX 모드에서는 기본적으로 외부 도메인을 허용하지 않음
      includeExternal: options?.includeExternal ?? (isMaxDepthMode ? false : undefined),
      ...options,
    };

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Run crawling in background
    (async () => {
      try {
        let results: Awaited<ReturnType<typeof crawlerEngine.crawlUrls>>;
        
        // Pagination 모드인 경우
        if (paginationMode) {
          if (urls.length !== 1) {
            writer.write(
              encoder.encode(
                JSON.stringify({
                  type: 'error',
                  error: 'Pagination 모드에서는 하나의 URL만 입력할 수 있습니다.',
                }) + '\n'
              )
            );
            await writer.close();
            return;
          }
          
          results = await crawlerEngine.crawlWithPagination(urls[0], crawlOptions, (progress) => {
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
        } else {
          // 일반 모드
          results = await crawlerEngine.crawlUrls(urls, crawlOptions, (progress) => {
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
        }

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
