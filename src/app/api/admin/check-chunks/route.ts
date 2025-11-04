import { NextRequest, NextResponse } from 'next/server';

/**
 * 청크 데이터 확인 API (디버깅용)
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 청크 데이터 확인 시작...');

    // Supabase 클라이언트 생성
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. 문서 목록 조회 (content 제외하여 응답 크기 제한)
    const { data: documents, error: docsError } = await supabase
      .from('documents')
      .select('id, title, status, chunk_count')
      .order('created_at', { ascending: false })
      .limit(50); // 최대 50개 문서로 제한

    if (docsError) {
      throw new Error(`문서 조회 오류: ${docsError.message}`);
    }

    // 2. 각 문서의 청크 데이터 조회 (큰 데이터 제외하여 응답 크기 제한)
    const documentChunks = [];
    for (const doc of documents || []) {
      // 청크 개수만 먼저 확인
      const { count: chunkCount, error: countError } = await supabase
        .from('document_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('document_id', doc.id);
      
      // 메타데이터만 조회 (content, embedding 제외)
      const { data: chunks, error: chunksError } = await supabase
        .from('document_chunks')
        .select('id, chunk_id, metadata')
        .eq('document_id', doc.id)
        .order('chunk_id', { ascending: true })
        .limit(100); // 최대 100개로 제한

      if (chunksError) {
        console.warn(`문서 ${doc.id} 청크 조회 오류:`, chunksError);
        continue;
      }

      documentChunks.push({
        document: {
          id: doc.id,
          title: doc.title,
          status: doc.status,
          chunk_count: doc.chunk_count,
          // content는 제외 (너무 큼)
        },
        chunks: (chunks || []).map(chunk => ({
          id: chunk.id,
          chunk_id: chunk.chunk_id,
          metadata: chunk.metadata,
          // content와 embedding은 제외 (응답 크기 제한)
        })),
        actualChunkCount: chunkCount || 0
      });
    }

    // 3. 임베딩 데이터 확인 (임베딩 벡터는 제외, 메타데이터만)
    const { data: allChunks, error: allChunksError } = await supabase
      .from('document_chunks')
      .select('id, document_id, chunk_id')
      .limit(5);

    if (allChunksError) {
      console.warn('전체 청크 조회 오류:', allChunksError);
    }

    // 4. 임베딩 벡터 분석 (임베딩 데이터는 직접 조회하지 않음)
    const { data: embeddingStats, error: embeddingStatsError } = await supabase
      .from('document_chunks')
      .select('id, document_id, chunk_id')
      .not('embedding', 'is', null)
      .limit(5);
    
    const embeddingAnalysis = (allChunks || []).map(chunk => ({
      id: chunk.id,
      document_id: chunk.document_id,
      chunk_id: chunk.chunk_id,
      has_embedding: embeddingStats?.some(s => s.id === chunk.id) || false,
      // embedding 데이터는 제외 (응답 크기 제한)
    }));

    console.log('✅ 청크 데이터 확인 완료');

    const response = NextResponse.json({
      success: true,
      data: {
        documents: documentChunks,
        embeddingAnalysis,
        summary: {
          totalDocuments: documents?.length || 0,
          totalChunks: documentChunks.reduce((sum, doc) => sum + doc.actualChunkCount, 0),
          documentsWithEmbeddings: documentChunks.filter(doc => 
            doc.chunks.length > 0
          ).length
        }
      }
    });

    // 캐싱 방지 헤더 추가
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');

    return response;

  } catch (error) {
    console.error('❌ 청크 데이터 확인 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '청크 데이터 확인 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
