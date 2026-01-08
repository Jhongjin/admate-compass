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
export const maxDuration = 300; // 5분 (Vercel Pro 플랜 실제 최대값)
// 참고: 223개 FAQ 크롤링은 약 18-19분 소요되므로, 큐 시스템 사용 권장

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
          
          results = await crawlerEngine.crawlWithPagination(urls[0], crawlOptions, async (progress) => {
            try {
              // 경고 메시지 전송 (타임아웃 위험 등) - 최우선 처리
              if (progress.type === 'warning') {
                console.log(`📤 [API] 경고 메시지 수신: ${progress.message.substring(0, 50)}...`);
                const warningData = JSON.stringify({
                  type: 'warning',
                  message: progress.message,
                  discoveredCount: (progress as any).discoveredCount,
                  safeCrawlableCount: (progress as any).safeCrawlableCount,
                  current: progress.current,
                  total: progress.total,
                }) + '\n';
                // 스트림이 준비될 때까지 기다린 후 전송
                await writer.ready;
                await writer.write(encoder.encode(warningData));
                console.log(`✅ [API] 경고 메시지 전송 완료`);
                // 추가로 log 타입으로도 전송하여 확실히 전달
                const logData = JSON.stringify({
                  type: 'log',
                  message: progress.message,
                  current: progress.current,
                  total: progress.total,
                }) + '\n';
                await writer.ready;
                await writer.write(encoder.encode(logData));
                return;
              }

              // 진행률 정보 전송
              if (progress.type === 'progress' && progress.progress) {
                await writer.write(
                  encoder.encode(
                    JSON.stringify({
                      type: 'progress',
                      ...progress.progress,
                    }) + '\n'
                  )
                );
              }

              // 로그 메시지 전송 (경고 키워드 포함 시 우선 처리)
              if (progress.type === 'log') {
                const logData = JSON.stringify({
                  type: 'log',
                  message: progress.message,
                  current: progress.current,
                  total: progress.total,
                }) + '\n';
                await writer.write(encoder.encode(logData));
                
                // 경고 키워드가 포함된 경우 warning으로도 전송
                if (progress.message.includes('⚠️') || progress.message.includes('경고') || progress.message.includes('위험') || progress.message.includes('타임아웃')) {
                  const warningData = JSON.stringify({
                    type: 'warning',
                    message: progress.message,
                    current: progress.current,
                    total: progress.total,
                  }) + '\n';
                  await writer.write(encoder.encode(warningData));
                }
              }

              // 배치 진행 상황 전송
              if (progress.type === 'batch_progress') {
                await writer.write(
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

              // 큐 시스템 정보 전송
              if (progress.type === 'queue_info') {
                await writer.write(
                  encoder.encode(
                    JSON.stringify({
                      type: 'queue_info',
                      message: progress.message,
                      current: progress.current,
                      total: progress.total,
                      jobIds: progress.jobIds || [],
                      note: '큐 시스템으로 전환되었습니다. 백그라운드에서 자동으로 처리됩니다. 관리자 페이지에서 진행 상황을 확인할 수 있습니다.',
                    }) + '\n'
                  )
                );
              }
            } catch (streamError) {
              // 스트림 오류는 로그만 남기고 계속 진행
              console.error('스트림 전송 오류:', streamError);
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
