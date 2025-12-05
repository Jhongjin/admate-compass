import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

/**
 * 크롤링 작업 상태 확인 API
 * 
 * 특정 작업 ID 또는 최근 작업의 상태를 확인합니다.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createPureClient();
    const body = await request.json();
    const { jobId, domain } = body;

    console.log('🔍 크롤링 작업 상태 확인 시작...', { jobId, domain });

    // 1. processing_jobs 테이블에서 작업 상태 확인
    let jobsQuery = supabase
      .from('processing_jobs')
      .select('id, job_type, status, document_id, started_at, finished_at, result, error, created_at, updated_at, payload')
      .eq('job_type', 'CRAWL_SEED')
      .order('created_at', { ascending: false })
      .limit(10);

    if (jobId) {
      jobsQuery = jobsQuery.eq('id', jobId);
    }

    const { data: jobs, error: jobsError } = await jobsQuery;

    if (jobsError) {
      throw new Error(`작업 조회 실패: ${jobsError.message}`);
    }

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'CRAWL_SEED 작업을 찾을 수 없습니다.',
        data: {
          jobs: [],
          documents: [],
          summary: {
            totalJobs: 0,
            completed: 0,
            processing: 0,
            failed: 0,
            pending: 0
          }
        }
      });
    }

    // 2. 각 작업에 대한 문서 상태 확인
    const jobIds = jobs.map(j => j.id);
    const documentIds = jobs.map(j => j.document_id).filter(Boolean) as string[];

    // 3. documents 테이블에서 관련 문서 조회
    let docsQuery = supabase
      .from('documents')
      .select('id, title, url, status, chunk_count, created_at, updated_at, type')
      .in('id', documentIds.length > 0 ? documentIds : [])
      .order('created_at', { ascending: false });

    if (domain) {
      docsQuery = docsQuery.ilike('url', `%${domain}%`);
    }

    const { data: documents, error: docsError } = await docsQuery;

    if (docsError) {
      console.warn('⚠️ 문서 조회 중 오류 (무시):', docsError);
    }

    // 4. 도메인별 문서 통계 (domain이 제공된 경우)
    let domainStats = null;
    let dbVerification = null;
    if (domain) {
      const { data: allDomainDocs } = await supabase
        .from('documents')
        .select('id, url, status, chunk_count, title, created_at, updated_at')
        .ilike('url', `%${domain}%`)
        .order('created_at', { ascending: false });

      if (allDomainDocs) {
        const indexed = allDomainDocs.filter(d => d.status === 'indexed').length;
        const processing = allDomainDocs.filter(d => d.status === 'processing').length;
        const failed = allDomainDocs.filter(d => d.status === 'failed').length;
        const pending = allDomainDocs.filter(d => d.status === 'pending').length;
        const totalChunks = allDomainDocs.reduce((sum, d) => sum + (d.chunk_count || 0), 0);

        domainStats = {
          total: allDomainDocs.length,
          indexed,
          processing,
          failed,
          pending,
          totalChunks
        };

        // 🔥 DB 저장 확인: 실제 청크와 임베딩이 있는지 확인
        const indexedDocs = allDomainDocs.filter(d => d.status === 'indexed');
        if (indexedDocs.length > 0) {
          const sampleDocIds = indexedDocs.slice(0, 5).map(d => d.id);
          
          // 실제 청크 수 확인
          const { data: chunksData, error: chunksError } = await supabase
            .from('document_chunks')
            .select('id, document_id, chunk_index')
            .in('document_id', sampleDocIds);

          const actualChunksCount = chunksData?.length || 0;
          const dbChunksCount = indexedDocs.slice(0, 5).reduce((sum, d) => sum + (d.chunk_count || 0), 0);

          // 임베딩 벡터 확인 (pgvector)
          const { data: embeddingsData, error: embeddingsError } = await supabase
            .from('document_chunks')
            .select('id, document_id, embedding')
            .in('document_id', sampleDocIds)
            .not('embedding', 'is', null)
            .limit(10);

          const embeddingsCount = embeddingsData?.length || 0;

          dbVerification = {
            sampleDocumentsChecked: sampleDocIds.length,
            documentsWithChunks: chunksData ? new Set(chunksData.map(c => c.document_id)).size : 0,
            actualChunksInDB: actualChunksCount,
            dbChunksCount: dbChunksCount,
            chunksMatch: actualChunksCount === dbChunksCount,
            documentsWithEmbeddings: embeddingsData ? new Set(embeddingsData.map(e => e.document_id)).size : 0,
            embeddingsCount: embeddingsCount,
            verificationStatus: actualChunksCount > 0 && embeddingsCount > 0 ? 'verified' : 'incomplete',
            sampleUrls: indexedDocs.slice(0, 5).map(d => ({
              url: d.url,
              chunkCount: d.chunk_count || 0,
              status: d.status
            }))
          };

          console.log('🔍 [DB 저장 확인]:', {
            sampleDocs: sampleDocIds.length,
            actualChunks: actualChunksCount,
            dbChunks: dbChunksCount,
            embeddings: embeddingsCount,
            status: dbVerification.verificationStatus
          });
        }
      }
    }

    // 5. 작업별 상세 정보 구성
    const jobsWithDocs = jobs.map(job => {
      const relatedDocs = (documents || []).filter(d => d.id === job.document_id);
      const result = job.result as any;

      return {
        jobId: job.id,
        jobType: job.job_type,
        status: job.status,
        documentId: job.document_id,
        startedAt: job.started_at,
        finishedAt: job.finished_at,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        error: job.error,
        result: {
          mainDocument: result?.mainDocument || null,
          subPagesCount: result?.subPages?.length || 0,
          totalChunks: result?.totalChunks || 0,
          status: result?.status || null
        },
        documents: relatedDocs.map(doc => ({
          id: doc.id,
          title: doc.title,
          url: doc.url,
          status: doc.status,
          chunkCount: doc.chunk_count || 0,
          createdAt: doc.created_at,
          updatedAt: doc.updated_at
        }))
      };
    });

    // 6. 요약 통계
    const summary = {
      totalJobs: jobs.length,
      completed: jobs.filter(j => j.status === 'completed' && j.finished_at).length,
      processing: jobs.filter(j => j.status === 'processing').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      pending: jobs.filter(j => j.status === 'pending' || j.status === 'queued').length,
      retrying: jobs.filter(j => j.status === 'retrying').length
    };

    // 7. 최근 작업의 완료 여부 확인
    const latestJob = jobs[0];
    const isCompleted = latestJob?.status === 'completed' && latestJob?.finished_at;
    const isProcessing = latestJob?.status === 'processing';
    const isFailed = latestJob?.status === 'failed';

    console.log('✅ 크롤링 작업 상태 확인 완료:', {
      totalJobs: jobs.length,
      latestJobStatus: latestJob?.status,
      latestJobFinished: latestJob?.finished_at,
      domainStats
    });

    return NextResponse.json({
      success: true,
      message: `크롤링 작업 상태 확인 완료 (총 ${jobs.length}개 작업)`,
      data: {
        jobs: jobsWithDocs,
        documents: documents || [],
        summary,
        domainStats,
        dbVerification, // 🔥 DB 저장 확인 결과 추가
        latestJob: {
          jobId: latestJob?.id,
          status: latestJob?.status,
          isCompleted,
          isProcessing,
          isFailed,
          finishedAt: latestJob?.finished_at,
          result: latestJob?.result
        }
      }
    });

  } catch (error) {
    console.error('❌ 크롤링 작업 상태 확인 오류:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: '크롤링 작업 상태 확인 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

