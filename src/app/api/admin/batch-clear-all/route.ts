import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function DELETE(request: NextRequest) {
  try {
    console.log('🗑️ 배치 삭제로 데이터 전체 삭제 시작...');

    // Supabase 클라이언트 생성
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    // 1. document_chunks 테이블 배치 삭제
    console.log('🗑️ document_chunks 테이블 배치 삭제 중...');
    
    let totalDeleted = 0;
    let batchSize = 500; // 더 작은 배치 크기
    let hasMore = true;
    let attempts = 0;
    const maxAttempts = 200; // 더 많은 시도

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

      // ID 기반으로 배치 삭제
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
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
        continue;
      }

      const deleted = count || 0;
      totalDeleted += deleted;
      console.log(`✅ 배치 ${attempts} 완료: ${deleted}개 삭제 (총 ${totalDeleted}개)`);

      // 삭제된 수가 배치 크기보다 작으면 더 이상 삭제할 데이터가 없음
      if (deleted < batchSize) {
        hasMore = false;
      }

      // 메모리 정리를 위한 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`✅ document_chunks 배치 삭제 완료: 총 ${totalDeleted}개 삭제`);

    // 2. documents 테이블 삭제
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

    // 3. document_metadata 테이블 삭제
    console.log('🗑️ document_metadata 테이블 삭제 중...');
    try {
      const { error: metaError, count: metaCount } = await supabase
        .from('document_metadata')
        .delete()
        .neq('id', '');

      if (metaError) {
        console.log('⚠️ document_metadata 삭제 오류 (무시):', metaError.message);
      } else {
        console.log(`✅ document_metadata 삭제 완료: ${metaCount || 0}개 삭제`);
      }
    } catch (error) {
      console.log('⚠️ document_metadata 테이블 처리 중 오류 (무시):', error);
    }

    // 4. 최종 확인
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
        totalDeleted,
        allEmpty
      }
    });

  } catch (error) {
    console.error('❌ 배치 삭제 중 오류 발생:', error);
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
