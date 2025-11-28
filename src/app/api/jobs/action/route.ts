import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

type ActionBody = {
  jobId: string;
  action: 'retry' | 'cancel' | 'reprocess' | 'delete';
  jobIds?: string[]; // 일괄 삭제용
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ActionBody;
    if (!body?.action) {
      return NextResponse.json({ success: false, error: 'action 필수' }, { status: 400 });
    }
    
    // delete 액션은 jobIds로 일괄 삭제 가능, 다른 액션은 jobId 필수
    if (body.action !== 'delete' && !body?.jobId) {
      return NextResponse.json({ success: false, error: 'jobId 필수' }, { status: 400 });
    }
    
    // delete 액션은 jobId 또는 jobIds 중 하나는 필수
    if (body.action === 'delete' && !body?.jobId && (!body?.jobIds || body.jobIds.length === 0)) {
      return NextResponse.json({ success: false, error: 'jobId 또는 jobIds 필수' }, { status: 400 });
    }
    
    const supabase = await createPureClient();

    if (body.action === 'cancel') {
      const { error } = await supabase
        .from('processing_jobs')
        .update({ status: 'cancelled', finished_at: new Date().toISOString() })
        .eq('id', body.jobId)
        .neq('status', 'completed');
      if (error) throw error;
      return NextResponse.json({ success: true, status: 'cancelled' }, { status: 200 });
    }

    if (body.action === 'delete') {
      // 단일 삭제 또는 일괄 삭제
      const jobIds = body.jobIds && body.jobIds.length > 0 ? body.jobIds : [body.jobId];
      
      // 삭제 가능한 상태 확인 (queued, failed, cancelled, retrying, 또는 멈춘 processing 작업)
      const { data: jobsToDelete, error: fetchError } = await supabase
        .from('processing_jobs')
        .select('id, status, started_at, document_id')
        .in('id', jobIds);
      
      if (fetchError) throw fetchError;
      
      // 멈춘 작업 감지: processing 상태이지만 started_at이 30분 이상 지난 경우
      const now = Date.now();
      const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30분
      
      const deletableJobIds: string[] = [];
      const stuckJobIds: string[] = [];
      const documentIdsToDelete = new Set<string>();
      
      for (const job of jobsToDelete || []) {
        if (['queued', 'failed', 'cancelled', 'retrying'].includes(job.status)) {
          deletableJobIds.push(job.id);
          // 처리되지 않은 문서(pending 상태이고 chunks가 0인 경우)는 함께 삭제
          if (job.document_id) {
            documentIdsToDelete.add(job.document_id);
          }
        } else if (job.status === 'processing') {
          // processing 작업: 멈춘 작업(30분 이상) 또는 강제 삭제 요청
          if (job.started_at) {
            const elapsed = now - new Date(job.started_at).getTime();
            if (elapsed > STUCK_THRESHOLD_MS) {
              // 멈춘 작업
              stuckJobIds.push(job.id);
              deletableJobIds.push(job.id);
              // 멈춘 작업의 문서도 함께 삭제
              if (job.document_id) {
                documentIdsToDelete.add(job.document_id);
              }
            } else if (body.forceDelete === true) {
              // 강제 삭제 요청 (30분 미만이어도 삭제 가능)
              stuckJobIds.push(job.id);
              deletableJobIds.push(job.id);
              if (job.document_id) {
                documentIdsToDelete.add(job.document_id);
              }
            }
          } else if (body.forceDelete === true) {
            // started_at이 없어도 강제 삭제 요청이면 삭제 가능
            stuckJobIds.push(job.id);
            deletableJobIds.push(job.id);
            if (job.document_id) {
              documentIdsToDelete.add(job.document_id);
            }
          }
        }
      }
      
      if (deletableJobIds.length === 0) {
        const errorMessage = body.forceDelete 
          ? '삭제 가능한 작업이 없습니다.'
          : '삭제 가능한 작업이 없습니다. (대기, 실패, 취소, 재시도 중인 작업 또는 30분 이상 진행 중인 멈춘 작업만 삭제 가능)';
        return NextResponse.json({ 
          success: false, 
          error: errorMessage
        }, { status: 400 });
      }
      
      // 멈춘 작업은 먼저 cancelled 상태로 변경
      if (stuckJobIds.length > 0) {
        const { error: cancelError } = await supabase
          .from('processing_jobs')
          .update({ status: 'cancelled', finished_at: new Date().toISOString() })
          .in('id', stuckJobIds)
          .eq('status', 'processing');
        
        if (cancelError) {
          console.warn('멈춘 작업 취소 오류:', cancelError);
        }
      }
      
      // 연결된 문서 삭제 (처리되지 않은 문서만)
      let deletedDocumentsCount = 0;
      if (documentIdsToDelete.size > 0) {
        const documentIdsArray = Array.from(documentIdsToDelete);
        
        // 처리되지 않은 문서만 삭제 (pending 상태이고 chunk_count가 0인 경우)
        const { data: documentsToCheck, error: docsError } = await supabase
          .from('documents')
          .select('id, status, chunk_count')
          .in('id', documentIdsArray);
        
        if (!docsError && documentsToCheck) {
          const documentsToDelete = documentsToCheck.filter(doc => 
            doc.status === 'pending' && (doc.chunk_count === 0 || doc.chunk_count === null)
          );
          
          if (documentsToDelete.length > 0) {
            const docIdsToDelete = documentsToDelete.map(doc => doc.id);
            
            // 문서와 관련된 데이터 삭제
            // 1. document_chunks 삭제 (CASCADE로 자동 삭제되지만 명시적으로)
            await supabase
              .from('document_chunks')
              .delete()
              .in('document_id', docIdsToDelete);
            
            // 2. document_metadata 삭제
            await supabase
              .from('document_metadata')
              .delete()
              .in('id', docIdsToDelete);
            
            // 3. document_processing_logs 삭제
            await supabase
              .from('document_processing_logs')
              .delete()
              .in('document_id', docIdsToDelete);
            
            // 4. documents 삭제
            const { error: deleteDocsError } = await supabase
              .from('documents')
              .delete()
              .in('id', docIdsToDelete);
            
            if (deleteDocsError) {
              console.warn('문서 삭제 오류:', deleteDocsError);
            } else {
              deletedDocumentsCount = docIdsToDelete.length;
            }
          }
        }
      }
      
      // 작업 삭제 실행
      const { error } = await supabase
        .from('processing_jobs')
        .delete()
        .in('id', deletableJobIds)
        .in('status', ['queued', 'failed', 'cancelled', 'retrying']);
      
      if (error) throw error;
      
      const deletedCount = deletableJobIds.length;
      let message = '';
      if (stuckJobIds.length > 0 && deletedDocumentsCount > 0) {
        message = `${deletedCount}개 작업과 ${deletedDocumentsCount}개 문서가 삭제되었습니다. (일반 작업: ${deletedCount - stuckJobIds.length}개, 멈춘 작업: ${stuckJobIds.length}개)`;
      } else if (stuckJobIds.length > 0) {
        message = `${deletedCount}개 작업이 삭제되었습니다. (일반: ${deletedCount - stuckJobIds.length}개, 멈춘 작업: ${stuckJobIds.length}개)`;
      } else if (deletedDocumentsCount > 0) {
        message = `${deletedCount}개 작업과 ${deletedDocumentsCount}개 문서가 삭제되었습니다.`;
      } else {
        message = `${deletedCount}개 작업이 삭제되었습니다.`;
      }
      
      return NextResponse.json({ 
        success: true, 
        deleted: deletedCount,
        deletedDocuments: deletedDocumentsCount,
        message
      }, { status: 200 });
    }

    if (body.action === 'retry' || body.action === 'reprocess') {
      // 작업 정보 조회 (job_type, document_id 포함)
      const { data: jobData, error: jobError } = await supabase
        .from('processing_jobs')
        .select('id, job_type, document_id, attempts, max_attempts, payload')
        .eq('id', body.jobId)
        .limit(1)
        .maybeSingle();
      if (jobError) throw jobError;
      if (!jobData) {
        return NextResponse.json({ success: false, error: '작업을 찾을 수 없습니다.' }, { status: 404 });
      }

      // PDF_PARSE/DOCX_PARSE 작업인 경우 문서 타입 확인
      if ((jobData.job_type === 'PDF_PARSE' || jobData.job_type === 'DOCX_PARSE') && jobData.document_id) {
        const { data: docData, error: docError } = await supabase
          .from('documents')
          .select('type, url, title')
          .eq('id', jobData.document_id)
          .maybeSingle();
        
        if (!docError && docData && (docData.type === 'url' || docData.url)) {
          // URL 크롤링 문서에 대해 PDF_PARSE/DOCX_PARSE 작업을 재시도하려는 경우
          // 작업을 자동으로 삭제하고 사용자에게 알림
          await supabase
            .from('processing_jobs')
            .delete()
            .eq('id', body.jobId);
          
          return NextResponse.json({ 
            success: false, 
            error: `이 작업은 URL 크롤링 문서에 대한 잘못된 작업 타입입니다 (${jobData.job_type}). 작업을 삭제했습니다. URL 크롤링을 다시 시작하거나 문서를 삭제하고 다시 크롤링해주세요.`,
            deleted: true,
            documentType: docData.type,
            documentTitle: docData.title
          }, { status: 400 });
        }
      }

      // 정상적인 재시도 처리
      const attempts = (jobData.attempts ?? 0) + 1;
      const backoffMs = Math.min(60000, 1000 * Math.pow(2, attempts));
      const scheduledAt = new Date(Date.now() + backoffMs).toISOString();

      const { error: upErr } = await supabase
        .from('processing_jobs')
        .update({ status: 'queued', attempts, scheduled_at: scheduledAt, finished_at: null, started_at: null })
        .eq('id', body.jobId);
      if (upErr) throw upErr;
      return NextResponse.json({ success: true, status: 'queued', attempts }, { status: 200 });
    }

    return NextResponse.json({ success: false, error: '지원하지 않는 action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}


