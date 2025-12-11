import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

/**
 * 좀비 작업(중복/멈춘 작업) 정리 API
 * - 같은 URL에 대한 중복 CRAWL_SEED 작업 중 오래된 것 삭제
 * - processing 상태이지만 실제로는 완료된 작업 completed로 업데이트
 * - 타임아웃된 작업 failed로 업데이트
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createPureClient();
    const body = await request.json();
    const { force = false } = body as { force?: boolean };
    
    console.log('🧹 좀비 작업 정리 시작...');
    
    // 1. 같은 URL에 대한 중복 CRAWL_SEED 작업 찾기
    const { data: allCrawlJobs, error: allJobsError } = await supabase
      .from('processing_jobs')
      .select('id, status, payload, started_at, finished_at, created_at, document_id, result')
      .eq('job_type', 'CRAWL_SEED')
      .in('status', ['queued', 'processing', 'retrying', 'completed', 'failed'])
      .order('created_at', { ascending: false })
      .limit(1000);
    
    if (allJobsError) {
      throw new Error(`작업 조회 실패: ${allJobsError.message}`);
    }
    
    if (!allCrawlJobs || allCrawlJobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: '정리할 작업이 없습니다.',
        deleted: 0,
        updated: 0
      });
    }
    
    // URL별로 작업 그룹화
    const urlToJobs = new Map<string, any[]>();
    allCrawlJobs.forEach(job => {
      const jobUrl = (job.payload as any)?.url || (job.result as any)?.url;
      if (jobUrl) {
        if (!urlToJobs.has(jobUrl)) {
          urlToJobs.set(jobUrl, []);
        }
        urlToJobs.get(jobUrl)!.push(job);
      }
    });
    
    let deletedCount = 0;
    let updatedCount = 0;
    const now = Date.now();
    // ⚠️ CRAWL_SEED는 10~15분 내 완료가 정상. 더 빠르게 정리해 무한 대기 방지.
    // deepCrawlTimeout 옵션이 있으면 30분으로 확장
    const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15분
    const DEEP_CRAWL_TIMEOUT_MS = 30 * 60 * 1000; // 30분
    
    // 2. 각 URL에 대해 중복 작업 정리
    for (const [url, jobs] of urlToJobs.entries()) {
      if (jobs.length <= 1) continue; // 중복 없음
      
      // 상태별로 분류
      const completedJobs = jobs.filter(j => j.status === 'completed' || j.finished_at);
      const activeJobs = jobs.filter(j => 
        ['queued', 'processing', 'retrying'].includes(j.status) && !j.finished_at
      );
      const failedJobs = jobs.filter(j => j.status === 'failed');
      
      // 완료된 작업이 있고 활성 작업도 있으면, 활성 작업 중 오래된 것 삭제
      if (completedJobs.length > 0 && activeJobs.length > 0) {
        // 가장 최신 완료 작업 찾기
        const latestCompleted = completedJobs.sort((a, b) => {
          const aTime = a.finished_at ? new Date(a.finished_at).getTime() : 0;
          const bTime = b.finished_at ? new Date(b.finished_at).getTime() : 0;
          return bTime - aTime;
        })[0];
        
        // 활성 작업 중 완료 작업보다 오래된 것 삭제
        const toDelete = activeJobs.filter(job => {
          const jobTime = job.created_at ? new Date(job.created_at).getTime() : 0;
          const completedTime = latestCompleted.finished_at 
            ? new Date(latestCompleted.finished_at).getTime() 
            : (latestCompleted.created_at ? new Date(latestCompleted.created_at).getTime() : 0);
          return jobTime < completedTime;
        });
        
        if (toDelete.length > 0) {
          const deleteIds = toDelete.map(j => j.id);
          const { error: deleteError } = await supabase
            .from('processing_jobs')
            .delete()
            .in('id', deleteIds);
          
          if (!deleteError) {
            deletedCount += deleteIds.length;
            console.log(`✅ 중복 작업 삭제: ${url} (${deleteIds.length}개)`);
          }
        }
      }
      
      // 같은 URL에 여러 활성 작업이 있으면 가장 최신 것만 남기고 나머지 삭제
      if (activeJobs.length > 1) {
        // created_at 기준으로 정렬하여 가장 최신 것만 남김
        const sortedActive = activeJobs.sort((a, b) => {
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bTime - aTime;
        });
        
        const toKeep = sortedActive[0];
        const toDelete = sortedActive.slice(1);
        
        if (toDelete.length > 0) {
          const deleteIds = toDelete.map(j => j.id);
          const { error: deleteError } = await supabase
            .from('processing_jobs')
            .delete()
            .in('id', deleteIds);
          
          if (!deleteError) {
            deletedCount += deleteIds.length;
            console.log(`✅ 중복 활성 작업 삭제: ${url} (${deleteIds.length}개)`);
          }
        }
      }
    }
    
    // 3. processing 상태이지만 실제로는 완료된 작업 completed로 업데이트
    const { data: stuckProcessingJobs, error: stuckError } = await supabase
      .from('processing_jobs')
      .select('id, document_id, status, payload, started_at, finished_at, created_at')
      .eq('job_type', 'CRAWL_SEED')
      .eq('status', 'processing')
      .is('finished_at', null)
      .order('created_at', { ascending: false })
      .limit(200);
    
    if (!stuckError && stuckProcessingJobs && stuckProcessingJobs.length > 0) {
      for (const job of stuckProcessingJobs) {
        const jobUrl = (job.payload as any)?.url;
        let document: any = null;
        
        // document_id로 문서 찾기
        if (job.document_id) {
          const { data: docById } = await supabase
            .from('documents')
            .select('id, status, chunk_count, url')
            .eq('id', job.document_id)
            .maybeSingle();
          if (docById) document = docById;
        }
        
        // URL로 문서 찾기
        if (!document && jobUrl) {
          const { data: docByUrl } = await supabase
            .from('documents')
            .select('id, status, chunk_count, url')
            .eq('url', jobUrl)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (docByUrl) document = docByUrl;
        }
        
        // 문서가 indexed/completed이거나 chunk_count > 0이면 completed로 업데이트
        if (document && (document.status === 'indexed' || document.status === 'completed' || (document.chunk_count && document.chunk_count > 0))) {
          const { error: updateError } = await supabase
            .from('processing_jobs')
            .update({
              status: 'completed',
              finished_at: new Date().toISOString(),
              result: {
                note: 'auto_synced_by_zombie_cleanup',
                documentStatus: document.status,
                chunkCount: document.chunk_count,
                syncedAt: new Date().toISOString()
              }
            })
            .eq('id', job.id)
            .eq('status', 'processing');
          
          // 문서 상태도 함께 업데이트 (pending -> indexed)
          if (!updateError && document.status === 'pending') {
            await supabase
              .from('documents')
              .update({
                status: 'indexed',
                updated_at: new Date().toISOString()
              })
              .eq('id', document.id)
              .eq('status', 'pending');
            console.log(`✅ 문서 ${document.id} 상태 업데이트: pending -> indexed`);
          }
          
          if (!updateError) {
            updatedCount++;
            console.log(`✅ 좀비 작업 completed로 업데이트: ${job.id.substring(0, 8)}... (문서: ${document.status}, 청크: ${document.chunk_count})`);
          }
        } else if (document && document.status === 'pending' && !force) {
          // pending 상태인 문서는 failed로 처리하지 않고 그대로 둠 (아직 처리 중일 수 있음)
          console.log(`ℹ️ pending 상태 문서는 건너뜀: ${document.id} (작업: ${job.id.substring(0, 8)}...)`);
        } else {
          // deepCrawlTimeout 옵션 확인하여 타임아웃 조정
          const deepCrawlTimeout = job.payload?.deepCrawlTimeout as boolean ?? false;
          const timeoutMs = deepCrawlTimeout ? DEEP_CRAWL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
          const timeoutMinutes = Math.round(timeoutMs / (60 * 1000));
          
          if (force || (job.started_at && (now - new Date(job.started_at).getTime()) > timeoutMs)) {
            // 타임아웃된 작업은 failed로 업데이트
            const { error: updateError } = await supabase
              .from('processing_jobs')
              .update({
                status: 'failed',
                finished_at: new Date().toISOString(),
                result: {
                  note: 'timeout_by_zombie_cleanup',
                  errorMessage: `작업 타임아웃: ${timeoutMinutes}분 이상 진행 중`,
                  syncedAt: new Date().toISOString()
                }
              })
              .eq('id', job.id)
              .eq('status', 'processing')
              .is('finished_at', null);
            
            if (!updateError) {
              updatedCount++;
              console.log(`⏰ 타임아웃 작업 failed로 업데이트: ${job.id.substring(0, 8)}... (타임아웃: ${timeoutMinutes}분)`);
            }
          }
        }
      }
    }
    
    console.log(`✅ 좀비 작업 정리 완료: 삭제 ${deletedCount}개, 업데이트 ${updatedCount}개`);
    
    return NextResponse.json({
      success: true,
      message: `좀비 작업 정리 완료: 삭제 ${deletedCount}개, 업데이트 ${updatedCount}개`,
      deleted: deletedCount,
      updated: updatedCount
    });
    
  } catch (err) {
    console.error('좀비 작업 정리 오류:', err);
    return NextResponse.json(
      { success: false, error: '좀비 작업 정리 중 오류가 발생했습니다.', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

