import { NextRequest, NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';

export async function POST(request: NextRequest) {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    console.log('🔧 임베딩 차원 불일치 해결 시작');
    
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
    
    // 1. 현재 임베딩 차원 확인
    const { data: chunks, error: fetchError } = await supabase
      .from('ollama_document_chunks')
      .select('chunk_id, embedding, metadata')
      .not('embedding', 'is', null);
    
    if (fetchError) {
      console.error('❌ 청크 조회 실패:', fetchError);
      return NextResponse.json({ 
        success: false, 
        error: '청크 조회 실패',
        details: fetchError.message 
      }, { status: 500 });
    }
    
    console.log(`📊 조회된 청크 수: ${chunks?.length || 0}개`);
    
    // 2. 768차원 임베딩을 1024차원으로 변환
    const updatePromises = (chunks || []).map(async (chunk) => {
      if (!chunk.embedding) {
        console.log(`⚠️ 청크 ${chunk.chunk_id}: 임베딩 없음`);
        return { chunk_id: chunk.chunk_id, success: false, error: '임베딩 없음' };
      }
      
      try {
        console.log(`🔍 청크 ${chunk.chunk_id} 처리 시작`);
        
        // 임베딩 데이터 파싱 및 강화된 디버깅
        console.log(`🔍 청크 ${chunk.chunk_id} 원본 임베딩 타입: ${typeof chunk.embedding}`);
        console.log(`🔍 청크 ${chunk.chunk_id} 원본 임베딩 길이: ${Array.isArray(chunk.embedding) ? chunk.embedding.length : 'N/A'}`);
        
        let embeddingArray: number[];
        if (typeof chunk.embedding === 'string') {
          try {
            embeddingArray = JSON.parse(chunk.embedding);
            console.log(`📊 청크 ${chunk.chunk_id}: JSON 파싱 후 차원 ${embeddingArray.length}`);
          } catch (parseError) {
            console.error(`❌ 청크 ${chunk.chunk_id} JSON 파싱 실패:`, parseError);
            return { chunk_id: chunk.chunk_id, success: false, error: `JSON 파싱 실패: ${parseError}` };
          }
        } else if (Array.isArray(chunk.embedding)) {
          embeddingArray = chunk.embedding;
          console.log(`📊 청크 ${chunk.chunk_id}: 배열 직접 사용, 차원 ${embeddingArray.length}`);
        } else {
          console.warn(`알 수 없는 임베딩 형식: ${chunk.chunk_id}, 타입: ${typeof chunk.embedding}`);
          return { chunk_id: chunk.chunk_id, success: false, error: `알 수 없는 임베딩 형식: ${typeof chunk.embedding}` };
        }
        
        // 임베딩 배열 유효성 검사
        if (!Array.isArray(embeddingArray) || embeddingArray.length === 0) {
          console.error(`❌ 청크 ${chunk.chunk_id}: 유효하지 않은 임베딩 배열`);
          return { chunk_id: chunk.chunk_id, success: false, error: '유효하지 않은 임베딩 배열' };
        }
        
        console.log(`📊 청크 ${chunk.chunk_id}: 최종 차원 ${embeddingArray.length}`);
        
        // 768차원인 경우 1024차원으로 확장
        if (embeddingArray.length === 768) {
          console.log(`🔄 청크 ${chunk.chunk_id}: 768 → 1024 차원 변환 시작`);
          const extendedEmbedding = [...embeddingArray, ...new Array(256).fill(0)];
          console.log(`📊 확장된 임베딩 차원: ${extendedEmbedding.length}`);
          
          // 벡터 타입으로 변환하여 저장
          const vectorEmbedding = `[${extendedEmbedding.join(',')}]`;
          
          console.log(`🔍 변환 전 차원: ${embeddingArray.length}, 변환 후 차원: ${extendedEmbedding.length}`);
          
          // 기존 메타데이터 사용 (이미 select에서 가져옴)
          const currentMetadata = chunk.metadata || {};
          console.log(`📊 청크 ${chunk.chunk_id}: 기존 메타데이터`, currentMetadata);
          
          const { error: updateError } = await supabase
            .from('ollama_document_chunks')
            .update({ 
              embedding: vectorEmbedding,
              metadata: {
                ...currentMetadata,
                embedding_dimension: 1024,
                previous_dimension: 768,
                dimension_fixed_at: new Date().toISOString()
              }
            })
            .eq('chunk_id', chunk.chunk_id);
          
          if (updateError) {
            console.error(`❌ 청크 ${chunk.chunk_id} 업데이트 실패:`, updateError);
            return { chunk_id: chunk.chunk_id, success: false, error: updateError.message };
          }
          
          console.log(`✅ 청크 ${chunk.chunk_id} 차원 변환 완료 (768 → 1024)`);
          return { 
            chunk_id: chunk.chunk_id, 
            success: true, 
            current_dimension: 768,
            expected_dimension: 1024,
            converted: true
          };
        } else if (embeddingArray.length === 1024) {
          console.log(`✅ 청크 ${chunk.chunk_id} 이미 1024차원`);
          return { 
            chunk_id: chunk.chunk_id, 
            success: true, 
            already_correct: true,
            current_dimension: 1024,
            expected_dimension: 1024
          };
        } else {
          console.warn(`⚠️ 청크 ${chunk.chunk_id} 예상치 못한 차원: ${embeddingArray.length}`);
          return { 
            chunk_id: chunk.chunk_id, 
            success: false, 
            error: `예상치 못한 차원: ${embeddingArray.length}`,
            current_dimension: embeddingArray.length,
            expected_dimension: 1024
          };
        }
      } catch (error) {
        console.error(`❌ 청크 ${chunk.chunk_id} 처리 실패:`, error);
        return { chunk_id: chunk.chunk_id, success: false, error: String(error) };
      }
    });
    
    const results = await Promise.all(updatePromises);
    const validResults = results.filter(r => r !== null);
    
    const convertedCount = validResults.filter(r => r?.converted).length;
    const successCount = validResults.filter(r => r?.success).length;
    const errorCount = validResults.filter(r => !r?.success).length;
    const alreadyCorrectCount = validResults.filter(r => r?.already_correct).length;
    
    console.log(`📊 차원 변환 결과: 변환됨 ${convertedCount}개, 성공 ${successCount}개, 오류 ${errorCount}개, 이미 정상 ${alreadyCorrectCount}개`);
    
    return NextResponse.json({
      success: true,
      message: '임베딩 차원 불일치 해결 완료',
      results: {
        total: validResults.length,
        converted: convertedCount,
        success: successCount,
        errors: errorCount,
        already_correct: alreadyCorrectCount,
        details: validResults
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 임베딩 차원 해결 실패:', error);
    
    // 에러 객체를 안전하게 문자열로 변환
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
      error: '임베딩 차원 해결 실패',
      details: errorMessage 
    }, { status: 500 });
  }
}
