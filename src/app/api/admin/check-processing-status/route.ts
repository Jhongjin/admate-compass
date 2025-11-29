import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

/**
 * processing 상태인 문서들의 실제 백엔드 상태를 체크하고 동기화
 * 
 * 체크 항목:
 * 1. documents 테이블의 status와 chunk_count 확인
 * 2. processing_jobs 테이블의 실제 작업 상태 확인
 * 3. document_chunks 테이블의 실제 청크 수 확인
 * 4. 불일치 발견 시 자동 동기화
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createPureClient();
    
    console.log('🔍 processing 상태 문서 백엔드 상태 체크 시작...');

    // 1. processing 상태인 모든 문서 조회
    const { data: processingDocs, error: docError } = await supabase
      .from('documents')
      .select('id, title, url, status, chunk_count, created_at, updated_at')
      .eq('status', 'processing')
      .order('updated_at', { ascending: false })
      .limit(500);

    if (docError) {
      throw new Error(`문서 조회 실패: ${docError.message}`);
    }

    console.log(`📋 발견된 processing 문서 수: ${processingDocs?.length || 0}`);

    if (!processingDocs || processingDocs.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'processing 상태인 문서가 없습니다.',
        data: {
          totalDocuments: 0,
          checked: 0,
          synced: 0,
          results: []
        }
      });
    }

    const results = [];
    let syncedCount = 0;

    // 2. 각 문서의 실제 상태 체크
    for (const doc of processingDocs) {
      const docCheck = {
        documentId: doc.id,
        title: doc.title,
        url: doc.url,
        currentStatus: doc.status,
        currentChunkCount: doc.chunk_count || 0,
        issues: [] as string[],
        actions: [] as string[]
      };

      try {
        // 2-1. 실제 청크 수 확인
        const { data: chunks, error: chunksError } = await supabase
          .from('document_chunks')
          .select('id')
          .eq('document_id', doc.id);

        if (chunksError) {
          docCheck.issues.push(`청크 조회 실패: ${chunksError.message}`);
          results.push({
            ...docCheck,
            status: 'error',
            message: `청크 조회 실패: ${chunksError.message}`
          });
          continue;
        }

        const actualChunkCount = chunks?.length || 0;
        const dbChunkCount = doc.chunk_count || 0;

        // 2-2. processing_jobs 상태 확인
        const { data: relatedJobs, error: jobsError } = await supabase
          .from('processing_jobs')
          .select('id, status, job_type, started_at, finished_at, result, error')
          .eq('document_id', doc.id)
          .order('created_at', { ascending: false })
          .limit(5);

        if (jobsError) {
          docCheck.issues.push(`작업 조회 실패: ${jobsError.message}`);
        }

        const activeJobs = relatedJobs?.filter(j => 
          ['queued', 'processing', 'retrying'].includes(j.status)
        ) || [];
        const completedJobs = relatedJobs?.filter(j => 
          j.status === 'completed' && j.finished_at
        ) || [];
        const failedJobs = relatedJobs?.filter(j => j.status === 'failed') || [];

        // 2-3. 상태 분석 및 동기화
        let needsSync = false;
        let newStatus = doc.status;
        let newChunkCount = dbChunkCount;

        // 케이스 1: 실제 청크가 있는데 processing 상태인 경우
        if (actualChunkCount > 0 && doc.status === 'processing') {
          needsSync = true;
          newStatus = 'indexed';
          newChunkCount = actualChunkCount;
          docCheck.issues.push(`청크가 ${actualChunkCount}개 있지만 processing 상태임`);
          docCheck.actions.push(`상태를 indexed로 변경, 청크 수를 ${actualChunkCount}로 업데이트`);
        }

        // 케이스 2: 청크 수 불일치
        if (actualChunkCount !== dbChunkCount) {
          needsSync = true;
          newChunkCount = actualChunkCount;
          docCheck.issues.push(`청크 수 불일치: DB=${dbChunkCount}, 실제=${actualChunkCount}`);
          docCheck.actions.push(`청크 수를 ${actualChunkCount}로 업데이트`);
          
          // 청크가 없으면 failed로 변경
          if (actualChunkCount === 0 && activeJobs.length === 0) {
            newStatus = 'failed';
            docCheck.actions.push(`상태를 failed로 변경 (청크 없음, 활성 작업 없음)`);
          }
        }

        // 케이스 3: 모든 작업이 완료되었는데 processing 상태인 경우
        if (completedJobs.length > 0 && activeJobs.length === 0 && doc.status === 'processing') {
          const latestCompletedJob = completedJobs[0];
          const jobResult = latestCompletedJob.result as any;
          const jobChunkCount = jobResult?.chunkCount || actualChunkCount;
          
          if (jobChunkCount > 0) {
            needsSync = true;
            newStatus = 'indexed';
            newChunkCount = jobChunkCount;
            docCheck.issues.push(`모든 작업이 완료되었지만 processing 상태임`);
            docCheck.actions.push(`상태를 indexed로 변경 (작업 완료, 청크: ${jobChunkCount})`);
          }
        }

        // 케이스 4: 모든 작업이 실패했는데 processing 상태인 경우
        if (failedJobs.length > 0 && activeJobs.length === 0 && actualChunkCount === 0 && doc.status === 'processing') {
          needsSync = true;
          newStatus = 'failed';
          docCheck.issues.push(`모든 작업이 실패했지만 processing 상태임`);
          docCheck.actions.push(`상태를 failed로 변경`);
        }

        // 케이스 5: 활성 작업이 없고 청크도 없는데 processing 상태인 경우 (타임아웃)
        if (activeJobs.length === 0 && actualChunkCount === 0 && doc.status === 'processing') {
          const updatedAt = doc.updated_at ? new Date(doc.updated_at).getTime() : 0;
          const createdAt = doc.created_at ? new Date(doc.created_at).getTime() : 0;
          const now = Date.now();
          const elapsedFromUpdate = updatedAt > 0 ? (now - updatedAt) / (60 * 1000) : 0; // 분 단위
          const elapsedFromCreate = createdAt > 0 ? (now - createdAt) / (60 * 1000) : 0; // 분 단위
          const elapsedMinutes = updatedAt > 0 ? elapsedFromUpdate : elapsedFromCreate;
          
          // 🔥 무한대기 방지: 30분 이상 업데이트가 없으면 failed로 간주 (기존 1시간에서 단축)
          const TIMEOUT_MINUTES = 30;
          if (elapsedMinutes > TIMEOUT_MINUTES) {
            needsSync = true;
            newStatus = 'failed';
            docCheck.issues.push(`무한대기 감지: ${elapsedMinutes.toFixed(0)}분 동안 업데이트 없음`);
            docCheck.actions.push(`상태를 failed로 변경 (타임아웃: ${elapsedMinutes.toFixed(0)}분)`);
          }
        }

        // 케이스 6: processing_jobs가 processing 상태인데 실제로는 멈춰있는 경우 (더 적극적 감지)
        if (activeJobs.length > 0 && doc.status === 'processing') {
          const stuckJob = activeJobs[0];
          const startedAt = stuckJob.started_at ? new Date(stuckJob.started_at).getTime() : null;
          const createdAt = stuckJob.created_at ? new Date(stuckJob.created_at).getTime() : null;
          const now = Date.now();
          const elapsed = startedAt ? now - startedAt : (createdAt ? now - createdAt : 0);
          const TIMEOUT_MS = 30 * 60 * 1000; // 30분
          
          // 작업이 30분 이상 진행 중이고 청크가 없으면 실패로 간주
          if (elapsed > TIMEOUT_MS && actualChunkCount === 0) {
            needsSync = true;
            newStatus = 'failed';
            docCheck.issues.push(`작업 타임아웃: ${Math.round(elapsed / (60 * 1000))}분 동안 진행 중인데 청크 없음`);
            docCheck.actions.push(`상태를 failed로 변경 (작업 타임아웃)`);
            
            // processing_jobs도 failed로 업데이트
            try {
              await supabase
                .from('processing_jobs')
                .update({
                  status: 'failed',
                  error: `작업 타임아웃: ${Math.round(elapsed / (60 * 1000))}분 이상 진행 중`,
                  finished_at: new Date().toISOString()
                })
                .eq('id', stuckJob.id)
                .eq('status', 'processing');
            } catch (jobUpdateError) {
              console.error(`작업 상태 업데이트 실패 (${stuckJob.id}):`, jobUpdateError);
            }
          }
        }

        // 3. 동기화 실행
        if (needsSync) {
          const updateData: any = {
            updated_at: new Date().toISOString()
          };

          if (newStatus !== doc.status) {
            updateData.status = newStatus;
          }
          if (newChunkCount !== dbChunkCount) {
            updateData.chunk_count = newChunkCount;
          }

          const { error: updateError } = await supabase
            .from('documents')
            .update(updateData)
            .eq('id', doc.id);

          if (updateError) {
            docCheck.issues.push(`동기화 실패: ${updateError.message}`);
            results.push({
              ...docCheck,
              status: 'error',
              message: `동기화 실패: ${updateError.message}`
            });
          } else {
            syncedCount++;
            results.push({
              ...docCheck,
              status: 'synced',
              message: `동기화 완료: ${doc.status} -> ${newStatus}, 청크 ${dbChunkCount} -> ${newChunkCount}`,
              newStatus,
              newChunkCount
            });
            console.log(`✅ 문서 동기화: ${doc.id} (${doc.title}) - ${doc.status} -> ${newStatus}`);
          }
        } else {
          // 동기화 불필요 - 정상 상태
          const hasActiveJobs = activeJobs.length > 0;
          results.push({
            ...docCheck,
            status: hasActiveJobs ? 'processing' : 'no_issue',
            message: hasActiveJobs 
              ? `정상 처리 중 (활성 작업 ${activeJobs.length}개, 청크 ${actualChunkCount}개)`
              : `정상 상태 (청크 ${actualChunkCount}개)`,
            activeJobsCount: activeJobs.length,
            actualChunkCount
          });
        }

      } catch (error) {
        console.error(`❌ 문서 체크 오류 (${doc.id}):`, error);
        results.push({
          ...docCheck,
          status: 'error',
          message: `체크 중 오류: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }

    console.log(`✅ 상태 체크 완료: ${results.length}개 문서 체크, ${syncedCount}개 동기화`);

    return NextResponse.json({
      success: true,
      message: `processing 상태 문서 ${results.length}개를 체크했습니다. ${syncedCount}개 문서를 동기화했습니다.`,
      data: {
        totalDocuments: processingDocs.length,
        checked: results.length,
        synced: syncedCount,
        results: results
      }
    });

  } catch (error) {
    console.error('❌ 상태 체크 오류:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: 'processing 상태 문서 체크 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

