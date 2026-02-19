import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function DELETE(request: NextRequest) {
  try {
    console.log('🗑️ 빠른 데이터 전체 삭제 시작...');

    // Supabase 클라이언트 생성
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    // 더 큰 배치 크기로 빠른 삭제
    let totalDeleted = 0;
    let batchSize = 2000; // 더 큰 배치 크기
    let hasMore = true;
    let attempts = 0;
    const maxAttempts = 50;

    console.log('🗑️ document_chunks 테이블 빠른 배치 삭제 중...');

    while (hasMore && attempts < maxAttempts) {
      attempts++;
      
      // 현재 남은 데이터 수 확인
      const { count: remainingCount } = await supabase
        .from('document_chunks')
        .select('*', { count: 'exact', head: true });

      if (!remainingCount || remainingCount === 0) {
        hasMore = false;
        break;
      }

      console.log(`📊 배치 ${attempts}: ${remainingCount}개 청크 남음`);

      // ID 기반으로 더 큰 배치 삭제
      const { data: chunksToDelete } = await supabase
        .from('document_chunks')
        .select('chunk_id')
        .limit(batchSize);

      if (!chunksToDelete || chunksToDelete.length === 0) {
        hasMore = false;
        break;
      }

      const chunkIds = chunksToDelete.map(chunk => chunk.chunk_id);
      
      const { error, count } = await supabase
        .from('document_chunks')
        .delete()
        .in('chunk_id', chunkIds);

      if (error) {
        console.error(`❌ 배치 ${attempts} 삭제 오류:`, error);
        // 오류가 발생해도 계속 시도
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
        continue;
      }

      const deleted = count || 0;
      totalDeleted += deleted;
      console.log(`✅ 배치 ${attempts} 완료: ${deleted}개 삭제 (총 ${totalDeleted}개)`);

      // 삭제된 수가 배치 크기보다 작으면 더 이상 삭제할 데이터가 없음
      if (deleted < batchSize) {
        hasMore = false;
      }

      // 메모리 정리를 위한 짧은 대기
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✅ document_chunks 빠른 삭제 완료: 총 ${totalDeleted}개 삭제`);

    // documents와 metadata는 이미 비어있을 가능성이 높지만 확인
    console.log('🗑️ documents 테이블 삭제 중...');
    const { error: docError, count: docCount } = await supabase
      .from('documents')
      .delete()
      .neq('id', '');

    if (docError) {
      console.error('❌ documents 삭제 오류:', docError);
    } else {
      console.log(`✅ documents 삭제 완료: ${docCount || 0}개 삭제`);
    }

    // 최종 확인
    console.log('🔍 최종 삭제 결과 확인 중...');
    
    const { count: finalChunks } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact', head: true });

    const { count: finalDocs } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true });

    const allEmpty = (finalChunks || 0) === 0 && (finalDocs || 0) === 0;
    
    console.log('📊 최종 삭제 결과:');
    console.log('  - documents:', finalDocs || 0);
    console.log('  - document_chunks:', finalChunks || 0);
    console.log('  - 모든 테이블 비어있음:', allEmpty);

    return NextResponse.json({
      success: allEmpty,
      message: allEmpty 
        ? '모든 데이터가 성공적으로 삭제되었습니다.' 
        : `삭제 진행 중... (문서: ${finalDocs || 0}, 청크: ${finalChunks || 0}개 남음)`,
      data: {
        finalCounts: {
          documents: finalDocs || 0,
          document_chunks: finalChunks || 0,
        },
        totalDeleted,
        allEmpty,
        remainingChunks: finalChunks || 0
      }
    });

  } catch (error) {
    console.error('❌ 빠른 삭제 중 오류 발생:', error);
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
