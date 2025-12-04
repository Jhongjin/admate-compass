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

    // 삭제 요청한 문서 수를 실제 삭제된 수로 간주 (검증 단계에서 확인)
    const actualDeletedCount = documentIds.length;
    console.log(`✅ ${actualDeletedCount}개 문서 삭제 요청 완료`);

    // 삭제 확인: 실제로 삭제되었는지 검증 (여러 번 시도)
    let remainingDocs: any[] = [];
    let verifyError: any = null;
    
    // 삭제 후 즉시 확인 (1초 대기)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 방법 1: ID로 직접 확인
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: verifyDocs, error: verifyErr } = await supabase
        .from('documents')
        .select('id, url, title, status')
        .in('id', documentIds)
        .limit(100);
      
      verifyError = verifyErr;
      remainingDocs = verifyDocs || [];
      
      if (verifyError) {
        console.warn(`⚠️ 삭제 확인 시도 ${attempt + 1}/5 중 오류:`, verifyError);
      } else if (remainingDocs.length === 0) {
        console.log(`✅ 삭제 확인 완료 (시도 ${attempt + 1}/5): 모든 문서가 성공적으로 삭제되었습니다.`);
        break;
      } else {
        console.warn(`⚠️ 삭제 확인 시도 ${attempt + 1}/5: ${remainingDocs.length}개 문서가 여전히 존재합니다.`, 
          remainingDocs.map(d => ({ id: d.id.substring(0, 8), url: d.url, status: d.status })));
        if (attempt < 4) {
          // 다음 시도 전 대기 (점진적으로 증가)
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }
    
    // 방법 2: 도메인으로도 재확인 (ID로 확인되지 않은 경우)
    if (remainingDocs.length > 0) {
      console.log(`🔍 도메인 기준으로 재확인 시작...`);
      const { data: domainDocs, error: domainError } = await supabase
        .from('documents')
        .select('id, url, title, status')
        .eq('type', 'url')
        .not('url', 'is', null);
      
      if (!domainError && domainDocs) {
        const stillExists = domainDocs.filter(doc => {
          if (!doc.url) return false;
          try {
            const docUrl = new URL(doc.url);
            return docUrl.hostname === domain || docUrl.hostname.endsWith(`.${domain}`);
          } catch {
            return doc.url.includes(domain);
          }
        });
        
        if (stillExists.length > 0) {
          console.warn(`⚠️ 도메인 재확인: ${stillExists.length}개 문서가 여전히 존재합니다:`, 
            stillExists.map(d => ({ id: d.id.substring(0, 8), url: d.url, status: d.status })));
          
          // 삭제된 ID 목록과 비교하여 실제로 삭제되지 않은 문서만 남김
          const actuallyRemaining = stillExists.filter(doc => documentIds.includes(doc.id));
          if (actuallyRemaining.length > 0) {
            remainingDocs = actuallyRemaining;
            console.warn(`⚠️ 실제로 삭제되지 않은 문서: ${actuallyRemaining.length}개`, 
              actuallyRemaining.map(d => ({ id: d.id.substring(0, 8), url: d.url })));
          } else {
            // 삭제된 ID가 아니면 다른 문서이므로 무시
            console.log(`✅ 도메인 재확인: 남은 문서는 삭제 대상이 아닙니다.`);
            remainingDocs = [];
          }
        } else {
          console.log(`✅ 도메인 재확인: 모든 문서가 삭제되었습니다.`);
          remainingDocs = [];
        }
      }
    }

    const verified = remainingDocs.length === 0;
    const verifiedCount = actualDeletedCount - remainingDocs.length;
    
    console.log(`📊 최종 삭제 검증 결과:`, {
      삭제_요청: documentIds.length,
      실제_삭제: actualDeletedCount,
      검증_성공: verified,
      검증_삭제: verifiedCount,
      남은_문서: remainingDocs.length,
      남은_문서_상세: remainingDocs.length > 0 ? remainingDocs.map(d => ({ id: d.id.substring(0, 8), url: d.url })) : []
    });

    return NextResponse.json({
      success: true,
      message: `${domain} 도메인의 ${actualDeletedCount}개 문서가 삭제되었습니다.${verified ? '' : ` (${remainingDocs.length}개 문서가 여전히 존재할 수 있음)`}`,
      deleted: {
        documents: actualDeletedCount,
        verified: verifiedCount,
        remaining: remainingDocs.length,
        chunks: 0, // 정확한 개수는 알 수 없음
        jobs: cancelledJobsCount
      },
      deletedDocuments: documents.map(d => ({
        id: d.id,
        url: d.url,
        title: d.title,
        status: d.status
      })),
      remainingDocuments: remainingDocs.length > 0 ? remainingDocs.map(d => ({
        id: d.id,
        url: d.url,
        title: d.title
      })) : undefined,
      verified
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

