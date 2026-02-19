import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function DELETE(request: NextRequest) {
  try {
    console.log('🗑️ 강제 데이터 전체 삭제 시작...');

    // Supabase 클라이언트 생성
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    // 삭제 순서: 외래키 제약조건을 고려하여 역순으로 삭제
    const tables = [
      'document_chunks',
      'document_metadata', 
      'documents'
    ];

    const results: Record<string, { success: boolean; count: number; error?: string }> = {};

    for (const table of tables) {
      try {
        console.log(`🗑️ ${table} 테이블 데이터 삭제 중...`);
        
        // 먼저 현재 데이터 수 확인
        const { count: beforeCount } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        // 모든 데이터 삭제 (TRUNCATE 대신 DELETE 사용)
        const { error, count } = await supabase
          .from(table)
          .delete()
          .neq('id', 'impossible_id'); // 모든 행 삭제를 위한 조건

        if (error) {
          console.error(`❌ ${table} 삭제 오류:`, error);
          results[table] = { success: false, count: 0, error: error.message };
        } else {
          console.log(`✅ ${table} 삭제 완료 (${beforeCount || 0}개 행 삭제)`);
          results[table] = { success: true, count: beforeCount || 0 };
        }
      } catch (error) {
        console.error(`❌ ${table} 처리 중 오류:`, error);
        results[table] = { 
          success: false, 
          count: 0, 
          error: error instanceof Error ? error.message : '알 수 없는 오류' 
        };
      }
    }

    // 삭제 후 최종 확인
    console.log('🔍 최종 삭제 결과 확인 중...');
    
    const finalCheck: Record<string, number> = {};
    
    for (const table of tables) {
      try {
        const { count } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });
        finalCheck[table] = count || 0;
      } catch (error) {
        console.error(`❌ ${table} 확인 오류:`, error);
        finalCheck[table] = -1; // 오류 표시
      }
    }

    // 모든 테이블이 비어있는지 확인
    const allEmpty = Object.values(finalCheck).every(count => count === 0);
    
    console.log('📊 최종 삭제 결과:');
    console.log('  - documents:', finalCheck.documents);
    console.log('  - document_chunks:', finalCheck.document_chunks);
    console.log('  - document_metadata:', finalCheck.document_metadata);
    console.log('  - 모든 테이블 비어있음:', allEmpty);

    return NextResponse.json({
      success: allEmpty,
      message: allEmpty 
        ? '모든 데이터가 성공적으로 삭제되었습니다.' 
        : '일부 데이터가 남아있을 수 있습니다.',
      data: {
        finalCounts: finalCheck,
        deletionResults: results,
        allEmpty
      }
    });

  } catch (error) {
    console.error('❌ 강제 데이터 삭제 중 오류 발생:', error);
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
