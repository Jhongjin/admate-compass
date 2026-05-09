import { NextRequest, NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';

export async function POST(request: NextRequest) {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    console.log('🔍 RPC 함수 테스트 시작');
    
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
    
    // 테스트용 임베딩 생성 (1024차원)
    const testEmbedding = new Array(1024).fill(0).map(() => Math.random() - 0.5);
    console.log(`📊 테스트 임베딩 차원: ${testEmbedding.length}`);
    
    // 1. RPC 함수 테스트
    console.log('🔍 search_ollama_documents RPC 함수 테스트');
    const { data: rpcData, error: rpcError } = await supabase.rpc('search_ollama_documents', {
      query_embedding: testEmbedding,
      match_threshold: 0.1,
      match_count: 5
    });
    
    if (rpcError) {
      console.error('❌ RPC 함수 오류:', rpcError);
    } else {
      console.log('✅ RPC 함수 성공:', rpcData?.length || 0, '개 결과');
    }
    
    // 2. 직접 테이블 쿼리 테스트
    console.log('🔍 직접 테이블 쿼리 테스트');
    const { data: directData, error: directError } = await supabase
      .from('ollama_document_chunks')
      .select('chunk_id, content, metadata, embedding')
      .not('embedding', 'is', null)
      .limit(5);
    
    if (directError) {
      console.error('❌ 직접 쿼리 오류:', directError);
    } else {
      console.log('✅ 직접 쿼리 성공:', directData?.length || 0, '개 결과');
    }
    
    // 3. 임베딩 데이터 확인
    const embeddingInfo = (directData || []).map(chunk => {
      let dimension = 0;
      try {
        if (typeof chunk.embedding === 'string') {
          const parsed = JSON.parse(chunk.embedding);
          dimension = Array.isArray(parsed) ? parsed.length : 0;
        } else if (Array.isArray(chunk.embedding)) {
          dimension = chunk.embedding.length;
        }
      } catch (error) {
        console.warn(`임베딩 파싱 실패: ${chunk.chunk_id}`);
      }
      
      return {
        chunk_id: chunk.chunk_id,
        dimension: dimension,
        has_embedding: !!chunk.embedding,
        content_preview: chunk.content?.substring(0, 100) + '...'
      };
    });
    
    return NextResponse.json({
      success: true,
      message: 'RPC 함수 테스트 완료',
      results: {
        rpc_function: {
          success: !rpcError,
          error: rpcError?.message || null,
          result_count: rpcData?.length || 0,
          data: rpcData
        },
        direct_query: {
          success: !directError,
          error: directError?.message || null,
          result_count: directData?.length || 0,
          data: directData
        },
        embedding_info: embeddingInfo
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ RPC 함수 테스트 실패:', error);
    
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
      error: 'RPC 함수 테스트 실패',
      details: errorMessage 
    }, { status: 500 });
  }
}


