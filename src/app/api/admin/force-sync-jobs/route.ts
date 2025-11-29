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

    // 1. processing 상태인 CRAWL_SEED 작업 조회 (최신순 정렬)
    const { data: processingJobs, error: jobsError } = await supabase
      .from('processing_jobs')
      .select('id, document_id, status, payload, started_at, finished_at, created_at')
      .eq('job_type', 'CRAWL_SEED')
      .eq('status', 'processing')
      .order('created_at', { ascending: false })
      .limit(100);

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

    // 2. 각 작업의 document_id 또는 URL로 documents 테이블 확인
    for (const job of processingJobs) {
      const jobUrl = (job.payload as any)?.url;
      
      try {
        let document: any = null;
        
        // 방법 1: document_id로 조회
        if (job.document_id) {
          const { data: docById, error: docError } = await supabase
            .from('documents')
            .select('id, title, status, chunk_count, url')
            .eq('id', job.document_id)
            .single();
          
          if (!docError && docById) {
            document = docById;
          }
        }
        
        // 방법 2: document_id가 없거나 찾지 못한 경우 URL로 조회
        if (!document && jobUrl) {
          const { data: docsByUrl, error: urlError } = await supabase
            .from('documents')
            .select('id, title, status, chunk_count, url')
            .eq('url', jobUrl)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          
          if (!urlError && docsByUrl) {
            document = docsByUrl;
            console.log(`📋 URL로 문서 찾음: ${jobUrl} -> ${docsByUrl.id}`);
          }
        }
        
        // 방법 3: result에서 documentId 확인
        if (!document) {
          const resultDocumentId = (job.payload as any)?.result?.documentId || 
                                   (job.payload as any)?.documentId;
          if (resultDocumentId) {
            const { data: docByResult, error: resultError } = await supabase
              .from('documents')
              .select('id, title, status, chunk_count, url')
              .eq('id', resultDocumentId)
              .single();
            
            if (!resultError && docByResult) {
              document = docByResult;
              console.log(`📋 result에서 문서 찾음: ${resultDocumentId}`);
            }
          }
        }

        if (!document) {
          console.log(`⚠️ 문서를 찾을 수 없습니다 (jobId: ${job.id}, documentId: ${job.document_id}, url: ${jobUrl})`);
          
          // 문서를 찾을 수 없는 경우, 2시간 이상 지난 작업은 failed로 처리
          const now = Date.now();
          const startedAt = job.started_at ? new Date(job.started_at).getTime() : null;
          const createdAt = job.created_at ? new Date(job.created_at).getTime() : null;
          const elapsed = startedAt ? now - startedAt : (createdAt ? now - createdAt : 0);
          const TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2시간
          
          if (elapsed > TIMEOUT_MS) {
            console.log(`⏰ 문서를 찾을 수 없는 작업 ${job.id}는 타임아웃되었습니다 (${Math.round(elapsed / (60 * 60 * 1000))}시간 경과)`);
            
            const { error: timeoutError } = await supabase
              .from('processing_jobs')
              .update({
                status: 'failed',
                finished_at: new Date().toISOString(),
                error: `작업 타임아웃: 문서를 찾을 수 없고 2시간 이상 진행 중`,
                result: {
                  note: 'timeout_no_document',
                  elapsedHours: Math.round(elapsed / (60 * 60 * 1000))
                }
              })
              .eq('id', job.id)
              .eq('status', 'processing');
            
            if (!timeoutError) {
              syncedCount++;
              results.push({
                jobId: job.id,
                documentId: job.document_id || null,
                url: jobUrl || null,
                status: 'timeout_no_document',
                message: `타임아웃으로 failed 처리됨 (문서 없음, ${Math.round(elapsed / (60 * 60 * 1000))}시간 경과)`
              });
            } else {
              results.push({
                jobId: job.id,
                documentId: job.document_id || null,
                url: jobUrl || null,
                status: 'error',
                message: `타임아웃 처리 실패: ${timeoutError.message}`
              });
            }
          } else {
            results.push({
              jobId: job.id,
              documentId: job.document_id || null,
              url: jobUrl || null,
              status: 'not_found',
              message: `문서를 찾을 수 없습니다 (경과: ${Math.round(elapsed / (60 * 1000))}분, 타임아웃까지 ${Math.round((TIMEOUT_MS - elapsed) / (60 * 1000))}분 남음)`
            });
          }
          continue;
        }

        // 3. 문서가 실제로 완료되었는지 확인
        const isCompleted = 
          document.status === 'indexed' || 
          (document.chunk_count && document.chunk_count > 0);

        if (isCompleted) {
          console.log(`✅ 작업 ${job.id}는 실제로 완료되었습니다 (문서 ID: ${document.id}, 상태: ${document.status}, 청크: ${document.chunk_count})`);

          // 4. processing_jobs를 completed로 업데이트 (document_id도 함께 업데이트)
          const updateData: any = {
            status: 'completed',
            finished_at: new Date().toISOString(),
            result: {
              note: 'force_synced_by_api',
              chunkCount: document.chunk_count || 0,
              documentStatus: document.status,
              documentId: document.id,
              syncedAt: new Date().toISOString()
            }
          };
          
          // document_id가 없었던 경우 업데이트
          if (!job.document_id && document.id) {
            updateData.document_id = document.id;
          }

          const { error: updateError, data: updateResult } = await supabase
            .from('processing_jobs')
            .update(updateData)
            .eq('id', job.id)
            .eq('status', 'processing')
            .select();

          if (updateError) {
            console.error(`❌ 작업 상태 업데이트 실패 (${job.id}):`, updateError);
            results.push({
              jobId: job.id,
              documentId: document.id,
              title: document.title,
              status: 'error',
              message: `상태 업데이트 실패: ${updateError.message}`
            });
          } else {
            if (updateResult && updateResult.length > 0) {
              // documents 테이블도 함께 업데이트 (처리중 -> indexed)
              if (document.status === 'processing' && document.chunk_count > 0) {
                const { error: docUpdateError } = await supabase
                  .from('documents')
                  .update({
                    status: 'indexed',
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', document.id)
                  .eq('status', 'processing');
                
                if (docUpdateError) {
                  console.error(`⚠️ 문서 상태 업데이트 실패 (${document.id}):`, docUpdateError);
                } else {
                  console.log(`✅ 문서 ${document.id} 상태 업데이트: processing -> indexed`);
                }
              }
              
              syncedCount++;
              console.log(`✅ 작업 ${job.id} 동기화 완료: processing -> completed`);
              results.push({
                jobId: job.id,
                documentId: document.id,
                title: document.title,
                status: 'synced',
                message: `완료로 동기화됨 (문서 ID: ${document.id}, 청크: ${document.chunk_count})`,
                chunkCount: document.chunk_count
              });
            } else {
              // 업데이트된 행이 없음 (이미 다른 상태로 변경됨)
              console.log(`⚠️ 작업 ${job.id}는 이미 다른 상태입니다`);
              results.push({
                jobId: job.id,
                documentId: document.id,
                title: document.title,
                status: 'already_updated',
                message: `이미 다른 상태로 변경됨 (현재 상태 확인 필요)`
              });
            }
          }
        } else {
          // 실제로 완료되지 않은 경우 - 하지만 2시간 이상 지났으면 failed로 처리
          const now = Date.now();
          const startedAt = job.started_at ? new Date(job.started_at).getTime() : null;
          const createdAt = job.created_at ? new Date(job.created_at).getTime() : null;
          // started_at이 없으면 created_at 기준으로 타임아웃 체크
          const elapsed = startedAt ? now - startedAt : (createdAt ? now - createdAt : 0);
          const TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2시간
          
          if (elapsed > TIMEOUT_MS) {
            console.log(`⏰ 작업 ${job.id}는 타임아웃되었습니다 (${Math.round(elapsed / (60 * 60 * 1000))}시간 경과, started_at: ${job.started_at ? '있음' : '없음'})`);
            
            // 타임아웃된 작업을 failed로 업데이트
            const { error: timeoutError } = await supabase
              .from('processing_jobs')
              .update({
                status: 'failed',
                finished_at: new Date().toISOString(),
                error: `작업 타임아웃: 2시간 이상 진행 중 (문서 상태: ${document.status}, 청크: ${document.chunk_count || 0})`,
                result: {
                  note: 'timeout_force_synced',
                  documentStatus: document.status,
                  chunkCount: document.chunk_count || 0,
                  elapsedHours: Math.round(elapsed / (60 * 60 * 1000))
                }
              })
              .eq('id', job.id)
              .eq('status', 'processing');
            
            if (!timeoutError) {
              // 관련 문서도 failed로 업데이트 (processing 상태이면서 chunk_count가 0인 경우)
              if (document.status === 'processing' && (document.chunk_count || 0) === 0) {
                await supabase
                  .from('documents')
                  .update({
                    status: 'failed',
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', document.id)
                  .eq('status', 'processing')
                  .eq('chunk_count', 0);
                console.log(`✅ 타임아웃된 작업의 관련 문서 ${document.id}도 failed로 업데이트`);
              }
              
              syncedCount++;
              results.push({
                jobId: job.id,
                documentId: document.id,
                title: document.title,
                status: 'timeout',
                message: `타임아웃으로 failed 처리됨 (${Math.round(elapsed / (60 * 60 * 1000))}시간 경과)`,
                chunkCount: document.chunk_count || 0
              });
            } else {
              results.push({
                jobId: job.id,
                documentId: document.id,
                title: document.title,
                status: 'error',
                message: `타임아웃 처리 실패: ${timeoutError.message}`
              });
            }
          } else {
            results.push({
              jobId: job.id,
              documentId: document.id,
              title: document.title,
              status: 'not_completed',
              message: `아직 완료되지 않음 (문서 상태: ${document.status}, 청크: ${document.chunk_count || 0}, 경과: ${Math.round(elapsed / (60 * 1000))}분)`,
              chunkCount: document.chunk_count || 0
            });
          }
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

