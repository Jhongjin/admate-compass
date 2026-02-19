import { NextRequest, NextResponse } from 'next/server';

/**
 * 모든 문서 데이터 삭제 (테스트용)
 */
export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest) {
  try {
    console.log('🗑️ 모든 문서 데이터 삭제 시작...');

    // Supabase 클라이언트 생성
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. document_chunks 테이블 삭제 (CASCADE로 자동 삭제되지만 명시적으로)
    const { error: chunksError } = await supabase
      .from('document_chunks')
      .delete()
      .neq('id', 0); // 모든 레코드 삭제

    if (chunksError) {
      console.warn('청크 삭제 경고:', chunksError);
    } else {
      console.log('✅ document_chunks 테이블 삭제 완료');
    }

    // 2. document_metadata 테이블 삭제
    const { error: metadataError } = await supabase
      .from('document_metadata')
      .delete()
      .neq('id', 'dummy'); // 모든 레코드 삭제

    if (metadataError) {
      console.warn('메타데이터 삭제 경고:', metadataError);
    } else {
      console.log('✅ document_metadata 테이블 삭제 완료');
    }

    // 3. documents 테이블 삭제
    const { error: documentsError } = await supabase
      .from('documents')
      .delete()
      .neq('id', 'dummy'); // 모든 레코드 삭제

    if (documentsError) {
      console.warn('문서 삭제 경고:', documentsError);
    } else {
      console.log('✅ documents 테이블 삭제 완료');
    }

    // 4. document_processing_logs 테이블 삭제
    const { error: logsError } = await supabase
      .from('document_processing_logs')
      .delete()
      .neq('id', 0); // 모든 레코드 삭제

    if (logsError) {
      console.warn('로그 삭제 경고:', logsError);
    } else {
      console.log('✅ document_processing_logs 테이블 삭제 완료');
    }

    console.log('🎉 모든 문서 데이터 삭제 완료');

    return NextResponse.json({
      success: true,
      message: '모든 문서 데이터가 성공적으로 삭제되었습니다.',
      data: {
        deletedTables: ['documents', 'document_chunks', 'document_metadata', 'document_processing_logs']
      }
    });

  } catch (error) {
    console.error('❌ 데이터 삭제 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '데이터 삭제 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
