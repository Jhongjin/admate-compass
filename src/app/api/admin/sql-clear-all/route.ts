import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function DELETE(request: NextRequest) {
  try {
    console.log('🗑️ SQL 직접 실행으로 데이터 전체 삭제 시작...');

    // Supabase 클라이언트 생성
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    // SQL 직접 실행을 통한 삭제
    const queries = [
      'DELETE FROM document_chunks;',
      'DELETE FROM documents;',
      'DELETE FROM document_metadata;'
    ];

    const results: Array<{ query: string; success: boolean; error?: string }> = [];

    for (const query of queries) {
      try {
        console.log(`🗑️ 실행 중: ${query}`);
        
        // RPC 함수를 통해 SQL 실행
        const { data, error } = await supabase.rpc('exec_sql', { 
          sql_query: query 
        });

        if (error) {
          console.error(`❌ 쿼리 실행 오류: ${query}`, error);
          results.push({ query, success: false, error: error.message });
        } else {
          console.log(`✅ 쿼리 실행 성공: ${query}`);
          results.push({ query, success: true });
        }
      } catch (error) {
        console.error(`❌ 쿼리 처리 중 오류: ${query}`, error);
        results.push({ 
          query, 
          success: false, 
          error: error instanceof Error ? error.message : '알 수 없는 오류' 
        });
      }
    }

    // 최종 확인
    console.log('🔍 최종 삭제 결과 확인 중...');
    
    const { count: finalChunks } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact', head: true });

    const { count: finalDocs } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true });

    const { count: finalMeta } = await supabase
      .from('document_metadata')
      .select('*', { count: 'exact', head: true });

    const allEmpty = (finalChunks || 0) === 0 && (finalDocs || 0) === 0;
    
    console.log('📊 최종 삭제 결과:');
    console.log('  - documents:', finalDocs || 0);
    console.log('  - document_chunks:', finalChunks || 0);
    console.log('  - document_metadata:', finalMeta || 0);
    console.log('  - 모든 테이블 비어있음:', allEmpty);

    return NextResponse.json({
      success: allEmpty,
      message: allEmpty 
        ? '모든 데이터가 성공적으로 삭제되었습니다.' 
        : `일부 데이터가 남아있습니다. (문서: ${finalDocs || 0}, 청크: ${finalChunks || 0})`,
      data: {
        finalCounts: {
          documents: finalDocs || 0,
          document_chunks: finalChunks || 0,
          document_metadata: finalMeta || 0
        },
        queryResults: results,
        allEmpty
      }
    });

  } catch (error) {
    console.error('❌ SQL 직접 실행 삭제 중 오류 발생:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : '알 수 없는 오류',
        details: error instanceof Error ? error.stack : String(error)
      },
      { status: 500 }
    );
  }
}
