import { NextRequest, NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';

export async function GET() {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    console.log('🔍 데이터 무결성 확인 시작');
    
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
    
    // 1. documents 테이블 상태 확인
    console.log('📊 documents 테이블 상태 확인');
    const { data: documents, error: docsError } = await supabase
      .from('documents')
      .select('id, title, type, created_at')
      .order('created_at', { ascending: false });
    
    if (docsError) {
      console.error('❌ documents 조회 오류:', docsError);
      return NextResponse.json({
        success: false,
        error: 'documents 조회 실패',
        details: docsError
      }, { status: 500 });
    }
    
    // 2. document_chunks 테이블 상태 확인
    console.log('📊 document_chunks 테이블 상태 확인');
    const { data: chunks, error: chunksError } = await supabase
      .from('document_chunks')
      .select('document_id, chunk_id, content')
      .limit(10);
    
    if (chunksError) {
      console.error('❌ document_chunks 조회 오류:', chunksError);
      return NextResponse.json({
        success: false,
        error: 'document_chunks 조회 실패',
        details: chunksError
      }, { status: 500 });
    }
    
    // 3. 외래키 무결성 확인
    console.log('🔍 외래키 무결성 확인');
    const documentIds = documents?.map(doc => doc.id) || [];
    const chunkDocumentIds = chunks?.map(chunk => chunk.document_id) || [];
    
    const orphanedChunks = chunkDocumentIds.filter(chunkDocId => 
      !documentIds.includes(chunkDocId)
    );
    
    const result = {
      success: true,
      message: '데이터 무결성 확인 완료',
      timestamp: new Date().toISOString(),
      analysis: {
        documents: {
          total: documents?.length || 0,
          ids: documentIds.slice(0, 5) // 처음 5개만 표시
        },
        chunks: {
          total: chunks?.length || 0,
          documentIds: chunkDocumentIds.slice(0, 5) // 처음 5개만 표시
        },
        integrity: {
          orphanedChunks: orphanedChunks.length,
          orphanedChunkIds: orphanedChunks.slice(0, 10) // 처음 10개만 표시
        }
      },
      recommendations: [] as string[]
    };
    
    // 4. 권장사항 생성
    if (orphanedChunks.length > 0) {
      result.recommendations.push(`${orphanedChunks.length}개의 고아 청크가 발견되었습니다.`);
      result.recommendations.push('고아 청크를 정리하거나 부모 문서를 생성해야 합니다.');
    } else {
      result.recommendations.push('데이터 무결성이 정상입니다.');
    }
    
    console.log('✅ 데이터 무결성 확인 완료:', {
      documents: documents?.length || 0,
      chunks: chunks?.length || 0,
      orphanedChunks: orphanedChunks.length
    });
    
    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
  } catch (error) {
    console.error('❌ 데이터 무결성 확인 실패:', error);
    
    return NextResponse.json({
      success: false,
      error: '데이터 무결성 확인 중 오류가 발생했습니다.',
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
