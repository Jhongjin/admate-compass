import { NextRequest, NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';

export async function GET() {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    console.log('🔍 임베딩 차원 확인 시작');
    
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
    
    // 1. 테이블 구조 확인
    console.log('📊 테이블 구조 확인');
    const { data: tableInfo, error: tableError } = await supabase
      .rpc('get_table_info', { table_name: 'document_chunks' });
    
    // 2. 실제 임베딩 데이터 확인
    console.log('🔍 실제 임베딩 데이터 확인');
    const { data: chunks, error: chunksError } = await supabase
      .from('document_chunks')
      .select('chunk_id, embedding')
      .limit(5);
    
    if (chunksError) {
      console.error('❌ 청크 조회 오류:', chunksError);
      return NextResponse.json({
        success: false,
        error: '청크 조회 실패',
        details: chunksError
      }, { status: 500 });
    }
    
    // 3. 임베딩 차원 분석
    const dimensionAnalysis = {
      totalChunks: chunks?.length || 0,
      dimensions: [] as number[],
      samples: [] as any[]
    };
    
    if (chunks && chunks.length > 0) {
      chunks.forEach((chunk, index) => {
        if (chunk.embedding) {
          try {
            let embedding;
            if (typeof chunk.embedding === 'string') {
              embedding = JSON.parse(chunk.embedding);
            } else if (Array.isArray(chunk.embedding)) {
              embedding = chunk.embedding;
            }
            
            if (embedding && Array.isArray(embedding) && embedding.length > 0) {
              dimensionAnalysis.dimensions.push(embedding.length);
              dimensionAnalysis.samples.push({
                chunk_id: chunk.chunk_id,
                dimension: embedding.length,
                first_few: embedding.slice(0, 5)
              });
            } else {
              console.warn(`청크 ${index} 유효하지 않은 임베딩:`, {
                chunk_id: chunk.chunk_id,
                embedding_type: typeof chunk.embedding,
                embedding_length: embedding?.length || 'N/A'
              });
            }
          } catch (error) {
            console.warn(`청크 ${index} 임베딩 파싱 실패:`, error);
          }
        }
      });
    }
    
    // 4. 차원 통계
    const uniqueDimensions = [...new Set(dimensionAnalysis.dimensions)];
    const dimensionCounts = uniqueDimensions.map(dim => ({
      dimension: dim,
      count: dimensionAnalysis.dimensions.filter(d => d === dim).length
    }));
    
    const result = {
      success: true,
      message: '임베딩 차원 확인 완료',
      timestamp: new Date().toISOString(),
      analysis: {
        totalChunks: dimensionAnalysis.totalChunks,
        uniqueDimensions,
        dimensionCounts,
        samples: dimensionAnalysis.samples.slice(0, 3)
      },
      recommendations: [] as string[]
    };
    
    // 5. 권장사항 생성
    if (uniqueDimensions.length === 0) {
      result.recommendations.push('임베딩 데이터가 없습니다. 문서를 업로드하고 인덱싱하세요.');
    } else if (uniqueDimensions.length === 1) {
      result.recommendations.push(`모든 임베딩이 ${uniqueDimensions[0]}차원으로 통일되어 있습니다.`);
    } else {
      result.recommendations.push(`임베딩 차원이 혼재되어 있습니다: ${uniqueDimensions.join(', ')}차원`);
      result.recommendations.push('모든 임베딩을 동일한 차원으로 통일해야 합니다.');
    }
    
    console.log('✅ 임베딩 차원 확인 완료:', {
      totalChunks: dimensionAnalysis.totalChunks,
      uniqueDimensions,
      dimensionCounts
    });
    
    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
  } catch (error) {
    console.error('❌ 임베딩 차원 확인 실패:', error);
    
    return NextResponse.json({
      success: false,
      error: '임베딩 차원 확인 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }, {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}
