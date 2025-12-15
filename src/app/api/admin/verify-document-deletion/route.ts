/**
 * 문서 삭제 검증 API
 * 백엔드에서 실제로 문서가 삭제되었는지 확인
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { documentIds, domain } = body;

    if (!documentIds && !domain) {
      return NextResponse.json({
        success: false,
        error: '문서 ID 목록 또는 도메인이 제공되지 않았습니다.'
      }, { status: 400 });
    }

    const supabase = await createPureClient();

    let query = supabase
      .from('documents')
      .select('id, title, url, status, chunk_count, created_at');

    if (documentIds && Array.isArray(documentIds) && documentIds.length > 0) {
      query = query.in('id', documentIds);
    }

    if (domain) {
      // 도메인으로 필터링
      const { data: allDocs } = await supabase
        .from('documents')
        .select('id, title, url, status, chunk_count, created_at')
        .eq('type', 'url')
        .not('url', 'is', null);

      if (allDocs) {
        const domainDocs = allDocs.filter(doc => {
          if (!doc.url) return false;
          try {
            const docUrl = new URL(doc.url);
            return docUrl.hostname === domain || docUrl.hostname.endsWith(`.${domain}`);
          } catch {
            return doc.url.includes(domain);
          }
        });

        return NextResponse.json({
          success: true,
          data: {
            total: domainDocs.length,
            documents: domainDocs,
            domain,
            message: domainDocs.length > 0 
              ? `${domain} 도메인에 ${domainDocs.length}개 문서가 존재합니다.`
              : `${domain} 도메인에 문서가 없습니다. (삭제 완료)`
          }
        });
      }
    }

    const { data: documents, error } = await query;

    if (error) {
      throw new Error(`문서 조회 실패: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      data: {
        total: documents?.length || 0,
        documents: documents || [],
        message: documents && documents.length > 0
          ? `${documents.length}개 문서가 여전히 존재합니다.`
          : '모든 문서가 삭제되었습니다.'
      }
    });

  } catch (error) {
    console.error('❌ 문서 삭제 검증 오류:', error);
    return NextResponse.json({
      success: false,
      error: '문서 삭제 검증 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}






