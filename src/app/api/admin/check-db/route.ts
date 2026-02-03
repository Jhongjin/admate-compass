import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { vectorStorageService } = await import('@/lib/services/VectorStorageService');
    
    // 1. documents 테이블 확인
    const { data: documents, error: docError } = await vectorStorageService.supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false });

    if (docError) {
      throw new Error(`문서 조회 실패: ${docError.message}`);
    }

    // 2. document_metadata 테이블 확인 (선택적)
    let metadata = [];
    let metaError = null;
    
    try {
      const { data, error } = await vectorStorageService.supabase
        .from('document_metadata')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.warn('document_metadata 테이블 조회 실패:', error.message);
        metadata = [];
      } else {
        metadata = data || [];
      }
    } catch (err) {
      console.warn('document_metadata 테이블이 존재하지 않습니다. documents 테이블만 사용합니다.');
      metadata = [];
    }

    // 3. document_chunks 테이블 확인
    const { data: chunks, error: chunkError } = await vectorStorageService.supabase
      .from('document_chunks')
      .select('*')
      .order('created_at', { ascending: false });

    if (chunkError) {
      throw new Error(`청크 조회 실패: ${chunkError.message}`);
    }

    // 4. 통계 계산
    const stats = {
      totalDocuments: documents?.length || 0,
      totalMetadata: metadata?.length || 0,
      totalChunks: chunks?.length || 0,
      txtDocuments: documents?.filter(doc => doc.type === 'txt').length || 0,
      pdfDocuments: documents?.filter(doc => doc.type === 'pdf').length || 0,
      docxDocuments: documents?.filter(doc => doc.type === 'docx').length || 0,
      urlDocuments: documents?.filter(doc => doc.type === 'url').length || 0,
    };

    return NextResponse.json({
      success: true,
      data: {
        stats,
        documents: documents?.map(doc => ({
          id: doc.id,
          title: doc.title,
          type: doc.type,
          status: doc.status,
          chunk_count: doc.chunk_count,
          created_at: doc.created_at,
          updated_at: doc.updated_at
        })) || [],
        metadata: metadata?.map(meta => ({
          id: meta.id,
          title: meta.title,
          type: meta.type,
          status: meta.status,
          chunk_count: meta.chunk_count,
          embedding_count: meta.embedding_count,
          created_at: meta.created_at,
          updated_at: meta.updated_at
        })) || [],
        chunks: chunks?.map(chunk => ({
          id: chunk.id,
          document_id: chunk.document_id,
          chunk_id: chunk.chunk_id,
          content: chunk.content?.substring(0, 100) + '...', // 내용은 일부만 표시
          metadata: chunk.metadata,
          created_at: chunk.created_at
        })) || []
      }
    });

  } catch (error) {
    console.error('데이터베이스 확인 오류:', error);
    return NextResponse.json(
      { 
        error: '데이터베이스 확인 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}


