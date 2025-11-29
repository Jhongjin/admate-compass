import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

/**
 * processing_jobs와 documents 테이블을 비교하여
 * 실제로 완료된 작업을 강제로 completed 상태로 업데이트
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createPureClient();
    
    console.log('🔧 강제 작업 동기화 시작...');

    // 1. processing 상태인 CRAWL_SEED 작업 조회
    const { data: processingJobs, error: jobsError } = await supabase
      .from('processing_jobs')
      .select('id, document_id, status, payload, started_at, finished_at')
      .eq('job_type', 'CRAWL_SEED')
      .eq('status', 'processing');

    if (jobsError) {
      throw new Error(`작업 조회 실패: ${jobsError.message}`);
    }

    if (!processingJobs || processingJobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: '동기화할 작업이 없습니다.',
        synced: 0
      });
    }

    console.log(`📋 발견된 processing 작업: ${processingJobs.length}개`);

    const results = [];
    let syncedCount = 0;

    // 2. 각 작업의 document_id로 documents 테이블 확인
    for (const job of processingJobs) {
      if (!job.document_id) {
        console.log(`⚠️ 작업 ${job.id}에 document_id가 없습니다.`);
        continue;
      }

      try {
        const { data: document, error: docError } = await supabase
          .from('documents')
          .select('id, title, status, chunk_count')
          .eq('id', job.document_id)
          .single();

        if (docError) {
          console.error(`❌ 문서 조회 실패 (${job.document_id}):`, docError);
          results.push({
            jobId: job.id,
            documentId: job.document_id,
            status: 'error',
            message: `문서 조회 실패: ${docError.message}`
          });
          continue;
        }

        if (!document) {
          console.log(`⚠️ 문서를 찾을 수 없습니다: ${job.document_id}`);
          results.push({
            jobId: job.id,
            documentId: job.document_id,
            status: 'not_found',
            message: '문서를 찾을 수 없습니다'
          });
          continue;
        }

        // 3. 문서가 실제로 완료되었는지 확인
        const isCompleted = 
          document.status === 'indexed' || 
          (document.chunk_count && document.chunk_count > 0);

        if (isCompleted) {
          console.log(`✅ 작업 ${job.id}는 실제로 완료되었습니다 (문서 상태: ${document.status}, 청크: ${document.chunk_count})`);

          // 4. processing_jobs를 completed로 업데이트
          const { error: updateError } = await supabase
            .from('processing_jobs')
            .update({
              status: 'completed',
              finished_at: new Date().toISOString(),
              result: {
                note: 'force_synced_by_api',
                chunkCount: document.chunk_count || 0,
                documentStatus: document.status,
                syncedAt: new Date().toISOString()
              }
            })
            .eq('id', job.id)
            .eq('status', 'processing');

          if (updateError) {
            console.error(`❌ 작업 상태 업데이트 실패 (${job.id}):`, updateError);
            results.push({
              jobId: job.id,
              documentId: job.document_id,
              title: document.title,
              status: 'error',
              message: `상태 업데이트 실패: ${updateError.message}`
            });
          } else {
            syncedCount++;
            results.push({
              jobId: job.id,
              documentId: job.document_id,
              title: document.title,
              status: 'synced',
              message: `완료로 동기화됨 (청크: ${document.chunk_count})`,
              chunkCount: document.chunk_count
            });
          }
        } else {
          // 실제로 완료되지 않은 경우
          results.push({
            jobId: job.id,
            documentId: job.document_id,
            title: document.title,
            status: 'not_completed',
            message: `아직 완료되지 않음 (문서 상태: ${document.status}, 청크: ${document.chunk_count || 0})`,
            chunkCount: document.chunk_count || 0
          });
        }
      } catch (error) {
        console.error(`❌ 작업 처리 오류 (${job.id}):`, error);
        results.push({
          jobId: job.id,
          documentId: job.document_id,
          status: 'error',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    console.log(`🎉 강제 동기화 완료: ${syncedCount}개 작업 동기화됨`);

    return NextResponse.json({
      success: true,
      message: `강제 동기화 완료: ${syncedCount}개 작업이 완료 상태로 업데이트되었습니다.`,
      synced: syncedCount,
      total: processingJobs.length,
      results: results
    });

  } catch (error) {
    console.error('❌ 강제 동기화 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

