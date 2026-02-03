import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';
import { sitemapDiscoveryService } from '@/lib/services/SitemapDiscoveryService';
import type { DepthAwareDiscoveredUrl } from '@/lib/services/SitemapDiscoveryService';

export const maxDuration = 300; // 5분 (Vercel Pro 최대값)

/**
 * URL 탐색 전용 API (RAG/임베딩 없이 URL만 발견)
 * POST /api/jobs/discover-urls
 * 
 * Body:
 * {
 *   url: string;
 *   maxDepth?: number; // 기본값: 3
 *   maxUrls?: number; // 기본값: 150
 *   respectRobots?: boolean; // 기본값: true
 *   domainLimit?: boolean; // 기본값: true
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, maxDepth = 3, maxUrls = 150, respectRobots = true, domainLimit = true } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL이 필요합니다.' },
        { status: 400 }
      );
    }

    // URL 유효성 검사
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { error: '유효하지 않은 URL입니다.' },
        { status: 400 }
      );
    }

    console.log(`[DISCOVER] 🔍 URL 탐색 시작: ${url}, maxDepth: ${maxDepth}, maxUrls: ${maxUrls}`);

    const supabase = await createPureClient();

    // Feature flag 확인 (서버 사이드 환경 변수)
    const enableDepthSelection = 
      process.env.ENABLE_DEPTH_SELECTION_MODE === 'true' ||
      process.env.NEXT_PUBLIC_ENABLE_DEPTH_SELECTION_MODE === 'true';
    if (!enableDepthSelection) {
      return NextResponse.json(
        { error: 'Depth 선택 모드가 비활성화되어 있습니다. ENABLE_DEPTH_SELECTION_MODE 또는 NEXT_PUBLIC_ENABLE_DEPTH_SELECTION_MODE=true로 설정하세요.' },
        { status: 403 }
      );
    }

    // 탐색 작업을 processing_jobs에 기록 (선택사항, 추적용)
    const { data: jobData, error: jobError } = await supabase
      .from('processing_jobs')
      .insert({
        job_type: 'DISCOVER_URLS',
        status: 'in_progress',
        payload: {
          url,
          maxDepth,
          maxUrls,
          respectRobots,
          domainLimit,
        },
      })
      .select('id')
      .single();

    if (jobError) {
      console.error('[DISCOVER] ❌ 작업 등록 실패:', jobError);
      // 작업 등록 실패해도 탐색은 계속 진행
    }

    const jobId = jobData?.id;

    try {
      // SitemapDiscoveryService 초기화
      await sitemapDiscoveryService.initialize();

      // BFS depth 탐색 실행
      const discoveredUrls = await sitemapDiscoveryService.discoverSubPagesWithDepth(url, {
        maxDepth: Math.max(1, Math.min(maxDepth, 4)), // 1~4로 제한
        maxUrls,
        respectRobotsTxt: respectRobots,
        includeExternal: !domainLimit,
        allowedDomains: domainLimit ? [new URL(url).hostname] : undefined,
      });

      // 탐색 결과를 discovered_urls 테이블에 저장 (선택사항)
      if (jobId && discoveredUrls.length > 0) {
        // 중복 체크: 같은 job_id와 url 조합이 이미 있는지 확인
        const { data: existingUrls, error: checkError } = await supabase
          .from('discovered_urls')
          .select('url')
          .eq('job_id', jobId);

        const existingUrlSet = new Set<string>();
        if (!checkError && existingUrls) {
          existingUrls.forEach((item) => {
            if (item.url) {
              existingUrlSet.add(item.url);
            }
          });
        }

        // 중복 제거: 이미 저장된 URL은 제외
        const uniqueDiscoveredUrls = discoveredUrls.filter((item) => !existingUrlSet.has(item.url));
        const duplicateCount = discoveredUrls.length - uniqueDiscoveredUrls.length;

        if (duplicateCount > 0) {
          console.log(`[DISCOVER] 🔍 중복 URL 제거: ${duplicateCount}개 (총 ${discoveredUrls.length}개 중)`);
        }

        if (uniqueDiscoveredUrls.length > 0) {
          const discoveredData = uniqueDiscoveredUrls.map((item) => ({
            job_id: jobId,
            url: item.url,
            title: item.title || null,
            depth: item.depth,
            parent_url: item.parentUrl || null,
            path: item.path || [],
            source: item.source,
            selected: false, // 기본값: 선택 안됨
          }));

          // 배치로 삽입 (Supabase 한도 고려)
          const BATCH_SIZE = 100;
          for (let i = 0; i < discoveredData.length; i += BATCH_SIZE) {
            const batch = discoveredData.slice(i, i + BATCH_SIZE);
            const { error: insertError } = await supabase
              .from('discovered_urls')
              .insert(batch);

            if (insertError) {
              console.error(`[DISCOVER] ⚠️ 배치 ${i / BATCH_SIZE + 1} 저장 실패:`, insertError);
              // 저장 실패해도 결과는 반환
            }
          }
        }
      }

      // 작업 상태 업데이트
      if (jobId) {
        await supabase
          .from('processing_jobs')
          .update({
            status: 'completed',
            result: {
              discoveredCount: discoveredUrls.length,
              byDepth: discoveredUrls.reduce((acc, item) => {
                acc[item.depth] = (acc[item.depth] || 0) + 1;
                return acc;
              }, {} as Record<number, number>),
            },
            finished_at: new Date().toISOString(),
          })
          .eq('id', jobId);
      }

      // Depth별 통계 계산
      const byDepth: Record<number, number> = {};
      for (const item of discoveredUrls) {
        byDepth[item.depth] = (byDepth[item.depth] || 0) + 1;
      }

      console.log(`[DISCOVER] ✅ URL 탐색 완료: ${discoveredUrls.length}개 발견`);

      return NextResponse.json({
        success: true,
        jobId: jobId || null,
        discoveredUrls: discoveredUrls.map((item) => ({
          url: item.url,
          title: item.title,
          depth: item.depth,
          parentUrl: item.parentUrl,
          path: item.path,
          source: item.source,
        })),
        totalCount: discoveredUrls.length,
        byDepth,
        status: 'completed',
      });
    } catch (error) {
      console.error('[DISCOVER] ❌ URL 탐색 실패:', error);

      // 작업 상태 업데이트 (실패)
      if (jobId) {
        await supabase
          .from('processing_jobs')
          .update({
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            finished_at: new Date().toISOString(),
          })
          .eq('id', jobId);
      }

      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'URL 탐색 중 오류가 발생했습니다.',
          jobId: jobId || null,
        },
        { status: 500 }
      );
    } finally {
      // SitemapDiscoveryService 정리
      await sitemapDiscoveryService.close();
    }
  } catch (error) {
    console.error('[DISCOVER] ❌ API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}

