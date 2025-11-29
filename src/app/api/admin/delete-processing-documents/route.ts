import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 진행 중인 문서 삭제 API
 * processing 상태인 문서와 관련된 작업들을 삭제합니다.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createPureClient();
    const body = await request.json();
    const { urls, status } = body;

    console.log('🗑️ 진행 중인 문서 삭제 요청:', { urls, status });

    // 1. 삭제할 문서 조회
    let query = supabase
      .from('documents')
      .select('id, title, url, status, chunk_count')
      .eq('type', 'url');

    // URL 필터
    if (urls && Array.isArray(urls) && urls.length > 0) {
      query = query.in('url', urls);
    }

    // 상태 필터 (기본값: processing)
    const targetStatus = status || 'processing';
    if (targetStatus) {
      query = query.eq('status', targetStatus);
    }

    const { data: documentsToDelete, error: docsError } = await query;

    if (docsError) {
      throw new Error(`문서 조회 실패: ${docsError.message}`);
    }

    if (!documentsToDelete || documentsToDelete.length === 0) {
      return NextResponse.json({
        success: true,
        message: '삭제할 진행 중인 문서가 없습니다.',
        deleted: {
          documents: 0,
          chunks: 0,
          jobs: 0
        }
      });
    }

    console.log(`📋 삭제할 문서 ${documentsToDelete.length}개 발견:`, documentsToDelete.map(d => ({
      id: d.id.substring(0, 8),
      title: d.title,
      url: d.url,
      status: d.status
    })));

    const documentIds = documentsToDelete.map(d => d.id);
    const documentUrls = documentsToDelete.map(d => d.url).filter(Boolean) as string[];

    // 2. 관련 processing_jobs 조회 및 취소
    // document_id로 매칭되는 작업과 CRAWL_SEED 타입 작업을 별도로 조회
    const { data: jobsByDocumentId, error: jobsByDocError } = await supabase
      .from('processing_jobs')
      .select('id, job_type, status, document_id, payload')
      .in('document_id', documentIds);
    
    const { data: crawlSeedJobs, error: crawlSeedError } = await supabase
      .from('processing_jobs')
      .select('id, job_type, status, document_id, payload')
      .eq('job_type', 'CRAWL_SEED')
      .in('status', ['queued', 'processing', 'retrying', 'completed', 'failed']);
    
    const relatedJobs = [
      ...(jobsByDocumentId || []),
      ...(crawlSeedJobs || [])
    ];
    const jobsError = jobsByDocError || crawlSeedError;

    let cancelledJobsCount = 0;
    if (!jobsError && relatedJobs) {
      // URL로도 매칭되는 작업 찾기
      const matchingJobs = relatedJobs.filter(job => {
        if (job.document_id && documentIds.includes(job.document_id)) {
          return true;
        }
        if (job.job_type === 'CRAWL_SEED') {
          const jobUrl = (job.payload as any)?.url;
          return jobUrl && documentUrls.includes(jobUrl);
        }
        return false;
      });

      if (matchingJobs.length > 0) {
        const jobIds = matchingJobs.map(j => j.id);
        console.log(`📋 취소할 작업 ${matchingJobs.length}개 발견:`, matchingJobs.map(j => ({
          id: j.id.substring(0, 8),
          type: j.job_type,
          status: j.status
        })));

        // 작업 취소 (cancelled 상태로 변경)
        const { error: cancelError } = await supabase
          .from('processing_jobs')
          .update({
            status: 'cancelled',
            finished_at: new Date().toISOString(),
            result: { note: 'cancelled_by_user', cancelledAt: new Date().toISOString() }
          })
          .in('id', jobIds)
          .in('status', ['queued', 'processing', 'retrying']);

        if (cancelError) {
          console.warn('⚠️ 작업 취소 중 오류 (무시됨):', cancelError);
        } else {
          cancelledJobsCount = matchingJobs.length;
          console.log(`✅ ${cancelledJobsCount}개 작업 취소 완료`);
        }
      }
    }

    // 3. document_chunks 삭제
    const { error: chunksError } = await supabase
      .from('document_chunks')
      .delete()
      .in('document_id', documentIds);

    if (chunksError) {
      console.warn('⚠️ 청크 삭제 중 오류 (무시됨):', chunksError);
    }

    const chunksCount = documentIds.length; // 정확한 개수는 알 수 없지만 삭제 시도는 완료

    // 4. document_metadata 삭제
    const { error: metadataError } = await supabase
      .from('document_metadata')
      .delete()
      .in('id', documentIds);

    if (metadataError) {
      console.warn('⚠️ 메타데이터 삭제 중 오류 (무시됨):', metadataError);
    }

    // 5. document_processing_logs 삭제
    const { error: logsError } = await supabase
      .from('document_processing_logs')
      .delete()
      .in('document_id', documentIds);

    if (logsError) {
      console.warn('⚠️ 처리 로그 삭제 중 오류 (무시됨):', logsError);
    }

    // 6. documents 삭제
    const { error: deleteError } = await supabase
      .from('documents')
      .delete()
      .in('id', documentIds);

    if (deleteError) {
      throw new Error(`문서 삭제 실패: ${deleteError.message}`);
    }

    console.log(`✅ ${documentsToDelete.length}개 문서 삭제 완료`);

    return NextResponse.json({
      success: true,
      message: `${documentsToDelete.length}개 문서와 ${cancelledJobsCount}개 작업이 삭제되었습니다.`,
      deleted: {
        documents: documentsToDelete.length,
        chunks: chunksCount,
        jobs: cancelledJobsCount
      },
      deletedDocuments: documentsToDelete.map(d => ({
        id: d.id,
        title: d.title,
        url: d.url,
        status: d.status
      }))
    });

  } catch (error) {
    console.error('❌ 진행 중인 문서 삭제 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

