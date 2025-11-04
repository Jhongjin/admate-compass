import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * 특정 문서의 청크 데이터 확인 API (디버깅용)
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('documentId');

    if (!documentId) {
      return NextResponse.json(
        { success: false, error: 'documentId 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    console.log('🔍 문서 청크 확인 시작:', documentId);

    // Supabase 클라이언트 생성
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. 문서 정보 조회
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, title, status, chunk_count, file_size, file_type, source_vendor')
      .eq('id', documentId)
      .single();

    if (docError) {
      throw new Error(`문서 조회 오류: ${docError.message}`);
    }

    if (!document) {
      return NextResponse.json(
        { success: false, error: '문서를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 2. 실제 청크 개수 확인
    const { count: actualChunkCount, error: countError } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', documentId);

    if (countError) {
      console.warn('청크 개수 조회 오류:', countError);
    }

    // 3. 청크 메타데이터 조회 (최대 20개)
    const { data: chunks, error: chunksError } = await supabase
      .from('document_chunks')
      .select('id, chunk_id, metadata, content')
      .eq('document_id', documentId)
      .order('chunk_id', { ascending: true })
      .limit(20);

    if (chunksError) {
      console.warn('청크 조회 오류:', chunksError);
    }

    // 4. 임베딩이 있는 청크 개수 확인
    const { count: chunksWithEmbedding, error: embeddingCountError } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', documentId)
      .not('embedding', 'is', null);

    if (embeddingCountError) {
      console.warn('임베딩 개수 조회 오류:', embeddingCountError);
    }

    // 5. 청크 샘플 (content 일부만)
    const chunkSamples = (chunks || []).map(chunk => ({
      id: chunk.id,
      chunk_id: chunk.chunk_id,
      content_preview: chunk.content?.substring(0, 100) || '',
      content_length: chunk.content?.length || 0,
      metadata: chunk.metadata,
      has_embedding: true, // 임베딩은 직접 확인하지 않음 (응답 크기 제한)
    }));

    console.log('✅ 문서 청크 확인 완료:', {
      documentId,
      documentChunkCount: document.chunk_count,
      actualChunkCount: actualChunkCount || 0,
      chunksWithEmbedding: chunksWithEmbedding || 0,
    });

    return NextResponse.json({
      success: true,
      data: {
        document: {
          id: document.id,
          title: document.title,
          status: document.status,
          chunk_count: document.chunk_count, // documents 테이블의 chunk_count
          file_size: document.file_size,
          file_type: document.file_type,
          source_vendor: document.source_vendor,
        },
        chunks: {
          actualCount: actualChunkCount || 0, // document_chunks 테이블의 실제 개수
          withEmbedding: chunksWithEmbedding || 0, // 임베딩이 있는 청크 개수
          samples: chunkSamples, // 샘플 청크 (최대 20개)
        },
        summary: {
          chunkCountMatch: document.chunk_count === (actualChunkCount || 0),
          embeddingCoverage: actualChunkCount 
            ? ((chunksWithEmbedding || 0) / actualChunkCount * 100).toFixed(1) + '%'
            : '0%',
        }
      }
    });

  } catch (error) {
    console.error('❌ 문서 청크 확인 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '문서 청크 확인 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

