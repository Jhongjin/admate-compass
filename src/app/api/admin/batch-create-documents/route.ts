import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

/**
 * 모달에서 선택한 모든 페이지를 한번에 documents 테이블에 추가
 * status: 'pending' (대기중)으로 설정하여 큐에서 순차적으로 처리
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { documents, vendor = 'META' } = body;

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return NextResponse.json(
        { success: false, error: '문서 목록이 제공되지 않았습니다.' },
        { status: 400 }
      );
    }

    const supabase = await createPureClient();
    const nowIso = new Date().toISOString();

    // 모든 문서를 한번에 생성 (upsert 사용하여 중복 방지)
    const documentsToInsert = documents.map((doc: { url: string; title: string }) => {
      const documentId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      return {
        id: documentId,
        title: doc.title || doc.url,
        type: 'url',
        status: 'pending', // 🔥 대기중 상태로 설정
        chunk_count: 0,
        url: doc.url,
        source_vendor: vendor,
        created_at: nowIso,
        updated_at: nowIso,
      };
    });

    // 기존 문서 확인 (URL 기준)
    const urls = documents.map((d: { url: string }) => d.url);
    const { data: existingDocs } = await supabase
      .from('documents')
      .select('id, url, title, status')
      .in('url', urls)
      .eq('type', 'url');

    const existingUrlMap = new Map<string, any>();
    (existingDocs || []).forEach(doc => {
      existingUrlMap.set(doc.url, doc);
    });

    // 새로 생성할 문서와 업데이트할 문서 분리
    const toInsert: any[] = [];
    const toUpdate: Array<{ id: string; title: string }> = [];

    documentsToInsert.forEach(doc => {
      const existing = existingUrlMap.get(doc.url);
      if (existing) {
        // 기존 문서가 있으면 제목만 업데이트 (모달의 정확한 제목 사용)
        if (existing.title !== doc.title) {
          toUpdate.push({ id: existing.id, title: doc.title });
        }
      } else {
        // 새 문서는 삽입
        toInsert.push(doc);
      }
    });

    // 새 문서 일괄 삽입
    if (toInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('documents')
        .insert(toInsert);

      if (insertError) {
        console.error('❌ 문서 일괄 삽입 실패:', insertError);
        return NextResponse.json(
          { success: false, error: '문서 생성 실패', details: insertError.message },
          { status: 500 }
        );
      }
      console.log(`✅ ${toInsert.length}개 문서 일괄 생성 완료 (status: queued)`);
    }

    // 기존 문서 제목 업데이트
    if (toUpdate.length > 0) {
      for (const update of toUpdate) {
        await supabase
          .from('documents')
          .update({ title: update.title, updated_at: nowIso })
          .eq('id', update.id);
      }
      console.log(`✅ ${toUpdate.length}개 문서 제목 업데이트 완료`);
    }

    // 생성된 문서 ID 반환
    const allUrls = documents.map((d: { url: string }) => d.url);
    const { data: createdDocs } = await supabase
      .from('documents')
      .select('id, url, title, status')
      .in('url', allUrls)
      .eq('type', 'url');

    return NextResponse.json({
      success: true,
      message: `${documents.length}개 문서가 대기중 상태로 생성되었습니다.`,
      documents: createdDocs || [],
      created: toInsert.length,
      updated: toUpdate.length
    });
  } catch (err) {
    console.error('배치 문서 생성 오류:', err);
    return NextResponse.json(
      { success: false, error: '문서 생성 중 오류가 발생했습니다.', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

