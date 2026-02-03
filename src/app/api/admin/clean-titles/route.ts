import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/client';

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    
    // 모든 URL 문서 조회
    const { data: documents, error: fetchError } = await supabase
      .from('documents')
      .select('id, title')
      .eq('type', 'url');

    if (fetchError) {
      console.error('문서 조회 오류:', fetchError);
      return NextResponse.json(
        { error: '문서 조회에 실패했습니다.' },
        { status: 500 }
      );
    }

    if (!documents || documents.length === 0) {
      return NextResponse.json({
        success: true,
        message: '처리할 문서가 없습니다.',
        updatedCount: 0
      });
    }

    let updatedCount = 0;
    const errors: string[] = [];

    // 각 문서의 제목에서 URL 정보 제거
    for (const doc of documents) {
      try {
        // 괄호와 그 안의 URL 정보 제거
        const cleanTitle = doc.title.replace(/\s*\([^)]*\)$/, '');
        
        if (cleanTitle !== doc.title) {
          // documents 테이블 업데이트
          const { error: docError } = await supabase
            .from('documents')
            .update({ title: cleanTitle })
            .eq('id', doc.id);

          if (docError) {
            console.error(`문서 ${doc.id} 업데이트 오류:`, docError);
            errors.push(`문서 ${doc.id}: ${docError.message}`);
            continue;
          }

          // document_metadata 테이블도 업데이트
          const { error: metaError } = await supabase
            .from('document_metadata')
            .update({ title: cleanTitle })
            .eq('id', doc.id);

          if (metaError) {
            console.error(`메타데이터 ${doc.id} 업데이트 오류:`, metaError);
            errors.push(`메타데이터 ${doc.id}: ${metaError.message}`);
          }

          updatedCount++;
          console.log(`✅ 제목 정리 완료: ${doc.title} → ${cleanTitle}`);
        }
      } catch (error) {
        console.error(`문서 ${doc.id} 처리 오류:`, error);
        errors.push(`문서 ${doc.id}: ${error}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `제목 정리 완료: ${updatedCount}개 문서 업데이트`,
      updatedCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('제목 정리 오류:', error);
    return NextResponse.json(
      { error: '제목 정리에 실패했습니다.' },
      { status: 500 }
    );
  }
}
