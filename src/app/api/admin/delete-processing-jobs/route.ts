import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * 진행중인 작업을 모두 삭제하는 관리자용 API
 * POST /api/admin/delete-processing-jobs
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createPureClient();
    
    // 진행중인 작업 조회
    const { data: processingJobs, error: fetchError } = await supabase
      .from('processing_jobs')
      .select('id, status, started_at, document_id')
      .in('status', ['queued', 'processing', 'retrying']);
    
    if (fetchError) {
      console.error('진행중인 작업 조회 오류:', fetchError);
      return NextResponse.json({ 
        success: false, 
        error: '진행중인 작업 조회 실패',
        details: fetchError.message 
      }, { status: 500 });
    }
    
    if (!processingJobs || processingJobs.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: '삭제할 진행중인 작업이 없습니다.',
        deleted: 0
      }, { status: 200 });
    }
    
    const jobIds = processingJobs.map(j => j.id);
    const documentIdsToDelete = new Set<string>();
    
    // 처리되지 않은 문서 ID 수집
    processingJobs.forEach(job => {
      if (job.document_id) {
        documentIdsToDelete.add(job.document_id);
      }
    });
    
    // 진행중인 작업을 먼저 cancelled 상태로 변경
    const { error: cancelError } = await supabase
      .from('processing_jobs')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .in('id', jobIds)
      .in('status', ['queued', 'processing', 'retrying']);
    
    if (cancelError) {
      console.warn('작업 취소 오류:', cancelError);
      // 취소 실패해도 삭제는 진행
    }
    
    // 처리되지 않은 문서 삭제
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
          await supabase.from('document_chunks').delete().in('document_id', docIdsToDelete);
          await supabase.from('document_metadata').delete().in('id', docIdsToDelete);
          await supabase.from('document_processing_logs').delete().in('document_id', docIdsToDelete);
          
          const { error: deleteDocsError } = await supabase
            .from('documents')
            .delete()
            .in('id', docIdsToDelete);
          
          if (!deleteDocsError) {
            deletedDocumentsCount = docIdsToDelete.length;
          }
        }
      }
    }
    
    // 작업 삭제 실행
    const { error: deleteError, count: deletedCount } = await supabase
      .from('processing_jobs')
      .delete()
      .in('id', jobIds);
    
    if (deleteError) {
      console.error('작업 삭제 오류:', deleteError);
      return NextResponse.json({ 
        success: false, 
        error: '작업 삭제 실패',
        details: deleteError.message 
      }, { status: 500 });
    }
    
    const message = deletedDocumentsCount > 0
      ? `${deletedCount || jobIds.length}개 작업과 ${deletedDocumentsCount}개 문서가 삭제되었습니다.`
      : `${deletedCount || jobIds.length}개 작업이 삭제되었습니다.`;
    
    return NextResponse.json({ 
      success: true, 
      message,
      deleted: deletedCount || jobIds.length,
      deletedDocuments: deletedDocumentsCount
    }, { status: 200 });
    
  } catch (error) {
    console.error('진행중인 작업 삭제 오류:', error);
    return NextResponse.json({ 
      success: false, 
      error: '진행중인 작업 삭제 중 오류 발생',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

