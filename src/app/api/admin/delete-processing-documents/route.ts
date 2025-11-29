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

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({
        success: false,
        error: '삭제할 URL이 제공되지 않았습니다.',
        deleted: {
          documents: 0,
          chunks: 0,
          jobs: 0
        }
      }, { status: 400 });
    }

    // 🔥 1단계: processing_jobs 테이블에서 URL로 매칭되는 작업 먼저 찾기
    const { data: allCrawlJobs, error: jobsError } = await supabase
      .from('processing_jobs')
      .select('id, job_type, status, document_id, payload, result, started_at, finished_at')
      .eq('job_type', 'CRAWL_SEED')
      .in('status', ['queued', 'processing', 'retrying', 'completed', 'failed', 'cancelled'])
      .order('created_at', { ascending: false })
      .limit(100);

    if (jobsError) {
      throw new Error(`작업 조회 실패: ${jobsError.message}`);
    }

    // URL로 매칭되는 작업 찾기
    const matchingJobs = (allCrawlJobs || []).filter(job => {
      const jobUrl = (job.payload as any)?.url || (job.result as any)?.url;
      return jobUrl && urls.includes(jobUrl);
    });

    console.log(`📋 URL로 매칭된 작업 ${matchingJobs.length}개 발견:`, matchingJobs.map(j => ({
      id: j.id.substring(0, 8),
      url: (j.payload as any)?.url,
      status: j.status,
      document_id: j.document_id
    })));

    if (matchingJobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: '삭제할 진행 중인 작업이 없습니다.',
        deleted: {
          documents: 0,
          chunks: 0,
          jobs: 0
        }
      });
    }

    // 2단계: 작업 취소 (cancelled 상태로 변경)
    const jobIds = matchingJobs.map(j => j.id);
    const jobIdsToCancel = matchingJobs
      .filter(j => ['queued', 'processing', 'retrying'].includes(j.status))
      .map(j => j.id);

    let cancelledJobsCount = 0;
    if (jobIdsToCancel.length > 0) {
      const { error: cancelError } = await supabase
        .from('processing_jobs')
        .update({
          status: 'cancelled',
          finished_at: new Date().toISOString(),
          result: { note: 'cancelled_by_user', cancelledAt: new Date().toISOString() }
        })
        .in('id', jobIdsToCancel)
        .in('status', ['queued', 'processing', 'retrying']);

      if (cancelError) {
        console.warn('⚠️ 작업 취소 중 오류 (무시됨):', cancelError);
      } else {
        cancelledJobsCount = jobIdsToCancel.length;
        console.log(`✅ ${cancelledJobsCount}개 작업 취소 완료`);
      }
    }

    // 3단계: 작업에서 document_id 수집
    const documentIdsFromJobs = matchingJobs
      .map(j => j.document_id)
      .filter((id): id is string => Boolean(id));

    // 4단계: documents 테이블에서 URL로 문서 찾기 (상태 무관)
    const { data: documentsByUrl, error: docsByUrlError } = await supabase
      .from('documents')
      .select('id, title, url, status, chunk_count')
      .eq('type', 'url')
      .in('url', urls);

    if (docsByUrlError) {
      console.warn('⚠️ URL로 문서 조회 중 오류 (무시됨):', docsByUrlError);
    }

    // 5단계: document_id로도 문서 찾기
    let documentsById: any[] = [];
    if (documentIdsFromJobs.length > 0) {
      const { data: docsById, error: docsByIdError } = await supabase
        .from('documents')
        .select('id, title, url, status, chunk_count')
        .in('id', documentIdsFromJobs);

      if (docsByIdError) {
        console.warn('⚠️ document_id로 문서 조회 중 오류 (무시됨):', docsByIdError);
      } else {
        documentsById = docsById || [];
      }
    }

    // 6단계: 중복 제거하여 최종 삭제할 문서 목록 생성
    const allDocuments = [
      ...(documentsByUrl || []),
      ...documentsById
    ];
    const uniqueDocuments = Array.from(
      new Map(allDocuments.map(d => [d.id, d])).values()
    );

    console.log(`📋 삭제할 문서 ${uniqueDocuments.length}개 발견:`, uniqueDocuments.map(d => ({
      id: d.id.substring(0, 8),
      title: d.title,
      url: d.url,
      status: d.status
    })));

    const documentIds = uniqueDocuments.map(d => d.id);
    const documentUrls = uniqueDocuments.map(d => d.url).filter(Boolean) as string[];

    // 문서가 없어도 작업은 취소했으므로 계속 진행

    // 7단계: 문서가 있으면 삭제
    let deletedDocumentsCount = 0;
    let chunksCount = 0;

    if (documentIds.length > 0) {
      // document_chunks 삭제
      const { error: chunksError } = await supabase
        .from('document_chunks')
        .delete()
        .in('document_id', documentIds);

      if (chunksError) {
        console.warn('⚠️ 청크 삭제 중 오류 (무시됨):', chunksError);
      } else {
        // 삭제된 청크 개수는 정확히 알 수 없지만 시도는 완료
        chunksCount = documentIds.length;
      }

      // document_metadata 삭제
      const { error: metadataError } = await supabase
        .from('document_metadata')
        .delete()
        .in('id', documentIds);

      if (metadataError) {
        console.warn('⚠️ 메타데이터 삭제 중 오류 (무시됨):', metadataError);
      }

      // document_processing_logs 삭제
      const { error: logsError } = await supabase
        .from('document_processing_logs')
        .delete()
        .in('document_id', documentIds);

      if (logsError) {
        console.warn('⚠️ 처리 로그 삭제 중 오류 (무시됨):', logsError);
      }

      // documents 삭제
      const { error: deleteError } = await supabase
        .from('documents')
        .delete()
        .in('id', documentIds);

      if (deleteError) {
        console.warn('⚠️ 문서 삭제 중 오류 (무시됨):', deleteError);
      } else {
        deletedDocumentsCount = documentIds.length;
        console.log(`✅ ${deletedDocumentsCount}개 문서 삭제 완료`);
      }
    }

    const totalDeleted = deletedDocumentsCount + cancelledJobsCount;
    const message = totalDeleted > 0
      ? `${deletedDocumentsCount}개 문서와 ${cancelledJobsCount}개 작업이 삭제되었습니다.`
      : `${cancelledJobsCount}개 작업이 취소되었습니다. (관련 문서 없음)`;

    return NextResponse.json({
      success: true,
      message,
      deleted: {
        documents: deletedDocumentsCount,
        chunks: chunksCount,
        jobs: cancelledJobsCount
      },
      deletedDocuments: uniqueDocuments.map(d => ({
        id: d.id,
        title: d.title,
        url: d.url,
        status: d.status
      })),
      cancelledJobs: matchingJobs.map(j => ({
        id: j.id,
        url: (j.payload as any)?.url,
        status: j.status
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

