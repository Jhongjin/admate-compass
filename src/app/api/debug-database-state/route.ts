import { NextRequest, NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';

export async function GET(request: NextRequest) {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    console.log('🔍 데이터베이스 상태 디버깅 시작');
    
    // Supabase 클라이언트 생성
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({
        success: false,
        error: 'Supabase 환경 변수가 설정되지 않았습니다.'
      }, { status: 500 });
    }
    
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // 1. ollama_document_chunks 테이블 상태 확인
    const { data: chunks, error: chunksError } = await supabase
      .from('ollama_document_chunks')
      .select('chunk_id, embedding, content, metadata')
      .limit(5);
    
    if (chunksError) {
      console.error('❌ 청크 조회 실패:', chunksError);
      return NextResponse.json({ 
        success: false, 
        error: '청크 조회 실패',
        details: chunksError.message 
      }, { status: 500 });
    }
    
    console.log(`📊 조회된 청크 수: ${chunks?.length || 0}개`);
    
    // 2. 각 청크의 임베딩 상태 분석
    const analysis = (chunks || []).map(chunk => {
      let embeddingStatus = 'none';
      let embeddingType = 'none';
      let embeddingLength = 0;
      
      if (chunk.embedding) {
        if (typeof chunk.embedding === 'string') {
          try {
            const parsed = JSON.parse(chunk.embedding);
            if (Array.isArray(parsed)) {
              embeddingStatus = 'valid';
              embeddingType = 'string-json';
              embeddingLength = parsed.length;
            } else {
              embeddingStatus = 'invalid';
              embeddingType = 'string-not-array';
            }
          } catch (error) {
            embeddingStatus = 'invalid';
            embeddingType = 'string-parse-error';
          }
        } else if (Array.isArray(chunk.embedding)) {
          embeddingStatus = 'valid';
          embeddingType = 'array';
          embeddingLength = chunk.embedding.length;
        } else {
          embeddingStatus = 'invalid';
          embeddingType = typeof chunk.embedding;
        }
      }
      
      return {
        chunk_id: chunk.chunk_id,
        content_preview: chunk.content?.substring(0, 100) + '...',
        embedding_status: embeddingStatus,
        embedding_type: embeddingType,
        embedding_length: embeddingLength,
        has_metadata: !!chunk.metadata,
        metadata_dimension: chunk.metadata?.embedding_dimension || 'unknown'
      };
    });
    
    // 3. 전체 통계
    const stats = {
      total_chunks: chunks?.length || 0,
      chunks_with_embedding: analysis.filter(a => a.embedding_status === 'valid').length,
      chunks_without_embedding: analysis.filter(a => a.embedding_status === 'none').length,
      chunks_with_invalid_embedding: analysis.filter(a => a.embedding_status === 'invalid').length,
      embedding_types: [...new Set(analysis.map(a => a.embedding_type))],
      embedding_lengths: [...new Set(analysis.map(a => a.embedding_length))].filter(l => l > 0)
    };
    
    console.log('📊 데이터베이스 상태 분석 완료:', stats);
    
    return NextResponse.json({
      success: true,
      message: '데이터베이스 상태 분석 완료',
      stats,
      analysis,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 데이터베이스 상태 디버깅 실패:', error);
    
    let errorMessage = '알 수 없는 오류';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error && typeof error === 'object') {
      errorMessage = JSON.stringify(error);
    }
    
    return NextResponse.json({ 
      success: false, 
      error: '데이터베이스 상태 디버깅 실패',
      details: errorMessage 
    }, { status: 500 });
  }
}


