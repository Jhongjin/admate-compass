import { NextRequest, NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';

export async function GET(request: NextRequest) {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    console.log('🔍 RPC 함수 직접 테스트 시작');
    
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
    const testEmbedding = new Array(1024).fill(0.1);
    
    console.log('📊 테스트 임베딩 생성:', testEmbedding.length, '차원');
    
    // 1. RPC 함수 직접 호출
    console.log('🔍 RPC 함수 호출 시도');
    const { data: rpcData, error: rpcError } = await supabase.rpc('search_ollama_documents', {
      query_embedding: testEmbedding,
      match_threshold: 0.001,
      match_count: 5
    });
    
    if (rpcError) {
      console.error('❌ RPC 함수 오류:', rpcError);
      return NextResponse.json({ 
        success: false, 
        error: 'RPC 함수 오류',
        details: rpcError 
      }, { status: 500 });
    }
    
    console.log('✅ RPC 함수 성공, 결과:', rpcData?.length || 0, '개');
    
    // 2. 직접 테이블 쿼리로 비교
    console.log('🔍 직접 테이블 쿼리 시도');
    const { data: directData, error: directError } = await supabase
      .from('ollama_document_chunks')
      .select('chunk_id, content, embedding, metadata')
      .not('embedding', 'is', null)
      .limit(5);
    
    if (directError) {
      console.error('❌ 직접 쿼리 오류:', directError);
    } else {
      console.log('✅ 직접 쿼리 성공, 결과:', directData?.length || 0, '개');
    }
    
    // 3. 결과 분석
    const analysis = {
      rpc_results: rpcData?.length || 0,
      direct_results: directData?.length || 0,
      rpc_sample: rpcData?.slice(0, 2).map((item: any) => ({
        chunk_id: item.chunk_id,
        has_content: !!item.content,
        has_embedding: !!item.embedding,
        has_metadata: !!item.metadata,
        similarity: item.similarity
      })) || [],
      direct_sample: directData?.slice(0, 2).map(item => ({
        chunk_id: item.chunk_id,
        has_content: !!item.content,
        has_embedding: !!item.embedding,
        has_metadata: !!item.metadata,
        embedding_type: typeof item.embedding,
        embedding_length: Array.isArray(item.embedding) ? item.embedding.length : 'N/A'
      })) || []
    };
    
    console.log('📊 분석 결과:', analysis);
    
    return NextResponse.json({
      success: true,
      message: 'RPC 함수 직접 테스트 완료',
      analysis,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ RPC 함수 직접 테스트 실패:', error);
    
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
      error: 'RPC 함수 직접 테스트 실패',
      details: errorMessage 
    }, { status: 500 });
  }
}


