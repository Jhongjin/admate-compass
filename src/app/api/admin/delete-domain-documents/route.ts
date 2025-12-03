import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * 특정 도메인의 모든 문서 삭제 API
 * POST /api/admin/delete-domain-documents
 * Body: { domain: string }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createPureClient();
    const body = await request.json();
    const { domain } = body;

    if (!domain) {
      return NextResponse.json({
        success: false,
        error: '도메인이 제공되지 않았습니다.',
        deleted: {
          documents: 0,
          chunks: 0,
          jobs: 0
        }
      }, { status: 400 });
    }

    console.log(`🗑️ 도메인 문서 삭제 요청: ${domain}`);

    // 1. 해당 도메인의 모든 문서 조회 (정확한 hostname 매칭)
    // URL에서 hostname을 추출하여 정확히 매칭
    const { data: allUrlDocs, error: allDocsError } = await supabase
      .from('documents')
      .select('id, title, url, status, chunk_count')
      .eq('type', 'url')
      .not('url', 'is', null);
    
    if (allDocsError) {
      throw new Error(`문서 조회 실패: ${allDocsError.message}`);
    }
    
    // URL에서 hostname을 추출하여 정확히 매칭
    const documents = (allUrlDocs || []).filter(doc => {
      if (!doc.url) return false;
      try {
        const docUrl = new URL(doc.url);
        // 정확한 hostname 매칭 또는 하위 도메인 매칭
        return docUrl.hostname === domain || docUrl.hostname.endsWith(`.${domain}`);
      } catch {
        // URL 파싱 실패 시 like로 폴백
        return doc.url.includes(domain);
      }
    });

    if (docsError) {
      throw new Error(`문서 조회 실패: ${docsError.message}`);
    }

    if (!documents || documents.length === 0) {
      return NextResponse.json({
        success: true,
        message: `해당 도메인(${domain})의 문서가 없습니다.`,
        deleted: {
          documents: 0,
          chunks: 0,
          jobs: 0
        }
      });
    }

    console.log(`📋 삭제할 문서 ${documents.length}개 발견:`, documents.map(d => ({
      id: d.id.substring(0, 8),
      url: d.url,
      status: d.status,
      chunk_count: d.chunk_count
    })));

    const documentIds = documents.map(d => d.id);

    // 2. 관련 작업 조회 및 취소
    const { data: relatedJobs, error: jobsError } = await supabase
      .from('processing_jobs')
      .select('id, status, document_id')
      .in('document_id', documentIds)
      .in('status', ['queued', 'processing', 'retrying']);

    if (jobsError) {
      console.warn('⚠️ 작업 조회 중 오류 (무시됨):', jobsError);
    }

    let cancelledJobsCount = 0;
    if (relatedJobs && relatedJobs.length > 0) {
      const jobIds = relatedJobs.map(j => j.id);
      const { error: cancelError } = await supabase
        .from('processing_jobs')
        .update({
          status: 'cancelled',
          finished_at: new Date().toISOString(),
          result: { note: 'cancelled_by_domain_deletion', cancelledAt: new Date().toISOString() }
        })
        .in('id', jobIds)
        .in('status', ['queued', 'processing', 'retrying']);

      if (cancelError) {
        console.warn('⚠️ 작업 취소 중 오류 (무시됨):', cancelError);
      } else {
        cancelledJobsCount = jobIds.length;
        console.log(`✅ ${cancelledJobsCount}개 작업 취소 완료`);
      }
    }

    // 3. 관련 데이터 삭제
    // document_chunks 삭제
    const { error: chunksError } = await supabase
      .from('document_chunks')
      .delete()
      .in('document_id', documentIds);

    if (chunksError) {
      console.warn('⚠️ 청크 삭제 중 오류 (무시됨):', chunksError);
    } else {
      console.log(`✅ 청크 삭제 완료`);
    }

    // document_metadata 삭제
    const { error: metadataError } = await supabase
      .from('document_metadata')
      .delete()
      .in('document_id', documentIds);

    if (metadataError) {
      console.warn('⚠️ 메타데이터 삭제 중 오류 (무시됨):', metadataError);
    } else {
      console.log(`✅ 메타데이터 삭제 완료`);
    }

    // document_logs 삭제
    const { error: logsError } = await supabase
      .from('document_logs')
      .delete()
      .in('document_id', documentIds);

    if (logsError) {
      console.warn('⚠️ 로그 삭제 중 오류 (무시됨):', logsError);
    } else {
      console.log(`✅ 로그 삭제 완료`);
    }

    // 4. documents 삭제
    const { error: deleteError } = await supabase
      .from('documents')
      .delete()
      .in('id', documentIds);

    if (deleteError) {
      throw new Error(`문서 삭제 실패: ${deleteError.message}`);
    }

    const deletedCount = documentIds.length;
    console.log(`✅ ${deletedCount}개 문서 삭제 완료`);

    // 삭제 확인: 실제로 삭제되었는지 검증
    const { data: remainingDocs, error: verifyError } = await supabase
      .from('documents')
      .select('id')
      .in('id', documentIds)
      .limit(10);
    
    if (verifyError) {
      console.warn('⚠️ 삭제 확인 중 오류 (무시됨):', verifyError);
    } else if (remainingDocs && remainingDocs.length > 0) {
      console.warn(`⚠️ ${remainingDocs.length}개 문서가 여전히 존재합니다. 삭제가 완전히 반영되지 않았을 수 있습니다.`);
    } else {
      console.log(`✅ 삭제 확인 완료: 모든 문서가 성공적으로 삭제되었습니다.`);
    }

    return NextResponse.json({
      success: true,
      message: `${domain} 도메인의 ${deletedCount}개 문서가 삭제되었습니다.`,
      deleted: {
        documents: deletedCount,
        chunks: 0, // 정확한 개수는 알 수 없음
        jobs: cancelledJobsCount
      },
      deletedDocuments: documents.map(d => ({
        id: d.id,
        url: d.url,
        title: d.title,
        status: d.status
      })),
      verified: remainingDocs ? remainingDocs.length === 0 : true
    });

  } catch (error) {
    console.error('❌ 도메인 문서 삭제 오류:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '문서 삭제 중 오류가 발생했습니다.',
      deleted: {
        documents: 0,
        chunks: 0,
        jobs: 0
      }
    }, { status: 500 });
  }
}

