import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function DELETE(request: NextRequest) {
  try {
    console.log('🗑️ Supabase 데이터 전체 삭제 시작...');

    // Supabase 클라이언트 생성
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    // 1. document_chunks 테이블 삭제 (모든 데이터)
    console.log('📄 document_chunks 테이블 데이터 삭제 중...');
    const { error: chunksError } = await supabase
      .from('document_chunks')
      .delete()
      .gte('id', 0); // 모든 데이터 삭제

    if (chunksError) {
      console.error('❌ document_chunks 삭제 오류:', chunksError);
    } else {
      console.log('✅ document_chunks 삭제 완료');
    }

    // 2. document_metadata 테이블 삭제 (모든 데이터)
    console.log('📊 document_metadata 테이블 데이터 삭제 중...');
    const { error: metadataError } = await supabase
      .from('document_metadata')
      .delete()
      .gte('id', 0); // 모든 데이터 삭제

    if (metadataError) {
      console.error('❌ document_metadata 삭제 오류:', metadataError);
    } else {
      console.log('✅ document_metadata 삭제 완료');
    }

    // 3. documents 테이블 삭제 (모든 데이터)
    console.log('📚 documents 테이블 데이터 삭제 중...');
    const { error: documentsError } = await supabase
      .from('documents')
      .delete()
      .gte('id', 0); // 모든 데이터 삭제

    if (documentsError) {
      console.error('❌ documents 삭제 오류:', documentsError);
    } else {
      console.log('✅ documents 삭제 완료');
    }

    // 4. 삭제 확인
    console.log('🔍 삭제 결과 확인 중...');
    
    const { data: documents, error: docCheckError } = await supabase
      .from('documents')
      .select('count')
      .limit(1);

    const { data: chunks, error: chunkCheckError } = await supabase
      .from('document_chunks')
      .select('count')
      .limit(1);

    const { data: metadata, error: metadataCheckError } = await supabase
      .from('document_metadata')
      .select('count')
      .limit(1);

    console.log('📊 삭제 후 데이터 수:');
    console.log('  - documents:', documents?.length || 0);
    console.log('  - document_chunks:', chunks?.length || 0);
    console.log('  - document_metadata:', metadata?.length || 0);

    return NextResponse.json({
      success: true,
      message: '모든 데이터가 성공적으로 삭제되었습니다.',
      data: {
        documents: documents?.length || 0,
        chunks: chunks?.length || 0,
        metadata: metadata?.length || 0
      }
    });

  } catch (error) {
    console.error('❌ 데이터 삭제 중 오류 발생:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류' 
      },
      { status: 500 }
    );
  }
}
