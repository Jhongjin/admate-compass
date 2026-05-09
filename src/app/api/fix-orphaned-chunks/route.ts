import { NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';

export async function POST() {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    console.log('🔧 고아 청크 수정 시작');
    
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
    
    // 1. 고아 청크 확인
    console.log('🔍 고아 청크 확인');
    const { data: orphanedChunks, error: orphanedError } = await supabase
      .from('document_chunks')
      .select('document_id, chunk_id, content, metadata')
      .not('document_id', 'in', `(SELECT id FROM documents)`);
    
    if (orphanedError) {
      console.error('❌ 고아 청크 조회 오류:', orphanedError);
      return NextResponse.json({
        success: false,
        error: '고아 청크 조회 실패',
        details: orphanedError
      }, { status: 500 });
    }
    
    if (!orphanedChunks || orphanedChunks.length === 0) {
      return NextResponse.json({
        success: true,
        message: '고아 청크가 없습니다.',
        processed: 0
      });
    }
    
    console.log(`📝 ${orphanedChunks.length}개 고아 청크 발견`);
    
    // 2. 고아 청크에 대한 문서 생성
    let processed = 0;
    let errors = 0;
    
    for (const chunk of orphanedChunks) {
      try {
        // 문서 ID에서 실제 문서명 추출
        const documentId = chunk.document_id;
        const documentTitle = documentId.replace(/_chunk_\d+$/, '').replace(/-/g, ' ');
        
        // 문서 생성
        const { error: docError } = await supabase
          .from('documents')
          .insert({
            id: documentId.replace(/_chunk_\d+$/, ''),
            title: documentTitle,
            type: 'file',
            uploaded_at: new Date().toISOString(),
            status: 'processed'
          });
        
        if (docError) {
          console.warn(`⚠️ 문서 ${documentId} 생성 실패 (이미 존재할 수 있음):`, docError);
        } else {
          console.log(`✅ 문서 ${documentId} 생성 완료`);
        }
        
        // 청크를 ollama_document_chunks로 복사
        const { error: chunkError } = await supabase
          .from('ollama_document_chunks')
          .insert({
            document_id: chunk.document_id.replace(/_chunk_\d+$/, ''),
            chunk_id: chunk.chunk_id,
            content: chunk.content,
            metadata: chunk.metadata,
            created_at: new Date().toISOString()
          });
        
        if (chunkError) {
          console.error(`❌ 청크 ${chunk.chunk_id} 복사 실패:`, chunkError);
          errors++;
        } else {
          console.log(`✅ 청크 ${chunk.chunk_id} 복사 완료`);
          processed++;
        }
        
      } catch (error) {
        console.error(`❌ 청크 ${chunk.chunk_id} 처리 실패:`, error);
        errors++;
      }
    }
    
    const result = {
      success: true,
      message: '고아 청크 수정 완료',
      processed,
      errors,
      total: orphanedChunks.length,
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ 고아 청크 수정 완료:', result);
    
    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
  } catch (error) {
    console.error('❌ 고아 청크 수정 실패:', error);
    
    return NextResponse.json({
      success: false,
      error: '고아 청크 수정 중 오류가 발생했습니다.',
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


