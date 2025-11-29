import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

export const maxDuration = 300; // 5분

/**
 * 중복 문서 정리 API
 * POST /api/admin/cleanup-duplicate-documents
 * 
 * 같은 URL에 대해 여러 문서가 있는 경우:
 * - 가장 최신 문서만 유지
 * - 나머지 중복 문서 중 processing 상태이면서 chunk_count=0인 것은 삭제
 * - 나머지 중복 문서는 failed 상태로 변경 (indexed는 유지)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createPureClient();
    
    // 모든 URL 크롤링 문서 조회
    const { data: allDocs, error: fetchError } = await supabase
      .from('documents')
      .select('id, url, title, status, chunk_count, created_at')
      .eq('type', 'url')
      .not('url', 'is', null)
      .order('created_at', { ascending: false });
    
    if (fetchError) {
      console.error('❌ 문서 조회 실패:', fetchError);
      return NextResponse.json(
        { success: false, error: '문서 조회 실패', details: fetchError.message },
        { status: 500 }
      );
    }
    
    if (!allDocs || allDocs.length === 0) {
      return NextResponse.json({
        success: true,
        message: '정리할 중복 문서가 없습니다.',
        cleaned: 0,
        failed: 0,
        deleted: 0
      });
    }
    
    // URL별로 그룹화
    const urlGroups = new Map<string, typeof allDocs>();
    for (const doc of allDocs) {
      if (!doc.url) continue;
      if (!urlGroups.has(doc.url)) {
        urlGroups.set(doc.url, []);
      }
      urlGroups.get(doc.url)!.push(doc);
    }
    
    // 중복이 있는 URL만 필터링
    const duplicateUrls = Array.from(urlGroups.entries())
      .filter(([_, docs]) => docs.length > 1)
      .map(([url]) => url);
    
    if (duplicateUrls.length === 0) {
      return NextResponse.json({
        success: true,
        message: '중복 문서가 없습니다.',
        cleaned: 0,
        failed: 0,
        deleted: 0
      });
    }
    
    console.log(`🔍 중복 문서 발견: ${duplicateUrls.length}개 URL에 대해 정리 시작`);
    
    let totalDeleted = 0;
    let totalFailed = 0;
    const deletedIds: string[] = [];
    const failedIds: string[] = [];
    
    for (const url of duplicateUrls) {
      const docs = urlGroups.get(url)!;
      // created_at 기준으로 정렬 (이미 정렬되어 있지만 확실하게)
      docs.sort((a, b) => {
        const aTime = new Date(a.created_at || 0).getTime();
        const bTime = new Date(b.created_at || 0).getTime();
        return bTime - aTime; // 최신이 먼저
      });
      
      const latestDoc = docs[0]; // 가장 최신 문서
      const duplicates = docs.slice(1); // 나머지 중복 문서
      
      // 중복 문서 중 processing 상태이면서 chunk_count=0인 것 삭제
      const toDelete = duplicates.filter(d => 
        d.status === 'processing' && (d.chunk_count === 0 || !d.chunk_count)
      );
      
      // 나머지 중복 문서는 failed 상태로 변경 (indexed는 유지)
      const toFail = duplicates.filter(d => 
        !toDelete.some(del => del.id === d.id) && d.status !== 'indexed'
      );
      
      if (toDelete.length > 0) {
        const deleteIds = toDelete.map(d => d.id);
        deletedIds.push(...deleteIds);
        
        // 관련 청크, 메타데이터, 로그도 함께 삭제
        await supabase.from('document_chunks').delete().in('document_id', deleteIds);
        await supabase.from('document_metadata').delete().in('document_id', deleteIds);
        await supabase.from('document_logs').delete().in('document_id', deleteIds);
        
        // 문서 삭제
        const { error: deleteError } = await supabase
          .from('documents')
          .delete()
          .in('id', deleteIds);
        
        if (deleteError) {
          console.error(`❌ 중복 문서 삭제 실패 (URL: ${url}):`, deleteError);
        } else {
          totalDeleted += deleteIds.length;
          console.log(`✅ 중복 문서 삭제 완료: ${deleteIds.length}개 (URL: ${url})`);
        }
      }
      
      if (toFail.length > 0) {
        const failIds = toFail.map(d => d.id);
        failedIds.push(...failIds);
        
        const { error: failError } = await supabase
          .from('documents')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .in('id', failIds)
          .neq('status', 'indexed'); // indexed는 변경하지 않음
        
        if (failError) {
          console.error(`❌ 중복 문서 failed 상태 변경 실패 (URL: ${url}):`, failError);
        } else {
          totalFailed += failIds.length;
          console.log(`✅ 중복 문서 failed 상태 변경 완료: ${failIds.length}개 (URL: ${url})`);
        }
      }
    }
    
    return NextResponse.json({
      success: true,
      message: `중복 문서 정리 완료: ${totalDeleted}개 삭제, ${totalFailed}개 failed 상태로 변경`,
      cleaned: duplicateUrls.length,
      deleted: totalDeleted,
      failed: totalFailed,
      deletedIds: deletedIds.slice(0, 100), // 최대 100개만 반환
      failedIds: failedIds.slice(0, 100) // 최대 100개만 반환
    });
  } catch (error) {
    console.error('❌ 중복 문서 정리 실패:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}

