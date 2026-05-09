import { NextRequest, NextResponse } from 'next/server';
import { createCompassServiceClient } from '@/lib/supabase/compass';

const supabase = createCompassServiceClient();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;

    console.log(`📥 파일 다운로드 요청: ${documentId}`);

    // 1. document_chunks에서 실제 문서 내용 조회
    const { data: chunkData, error: chunkError } = await supabase
      .from('document_chunks')
      .select('content, metadata, document_id')
      .eq('chunk_id', documentId)
      .single();

    if (chunkError || !chunkData) {
      console.error('❌ 청크 데이터 조회 오류:', chunkError);
      return NextResponse.json({ error: '문서 내용을 찾을 수 없습니다.' }, { status: 404 });
    }

    // 2. documents 테이블에서 메타데이터 조회 (옵셔널)
    let documentData = null;
    try {
      const { data: docData, error: docError } = await supabase
        .from('documents')
        .select('id, title, type, created_at, updated_at')
        .eq('id', chunkData.document_id)
        .single();

      if (!docError && docData) {
        documentData = docData;
      }
    } catch (error) {
      console.log('⚠️ 문서 메타데이터 조회 실패, 기본값 사용');
    }

    // 3. 실제 문서 내용으로 파일 생성
    const fileName = `${documentData?.title || documentId}.txt`;
    const fileContent = `문서 제목: ${documentData?.title || documentId}
문서 타입: ${documentData?.type || 'chunk'}
문서 ID: ${documentData?.id || chunkData.document_id}
생성일: ${documentData?.created_at ? new Date(documentData.created_at).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR')}
수정일: ${documentData?.updated_at ? new Date(documentData.updated_at).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR')}

========================================
문서 내용
========================================

${chunkData.content}

========================================
메타데이터
========================================

${JSON.stringify(chunkData.metadata, null, 2)}`;

    return new NextResponse(fileContent, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });

  } catch (error) {
    console.error('❌ 다운로드 API 오류:', error);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
