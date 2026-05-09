import { NextRequest, NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';

export async function GET() {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    console.log('🔍 테이블 제약조건 확인 시작');
    
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
    
    // 1. ollama_document_chunks 테이블 제약조건 확인
    console.log('📊 ollama_document_chunks 테이블 제약조건 확인');
    const { data: constraints, error: constraintsError } = await supabase
      .rpc('get_table_constraints', { table_name: 'ollama_document_chunks' });
    
    // 2. 외래키 제약조건 확인
    console.log('🔍 외래키 제약조건 확인');
    const { data: foreignKeys, error: fkError } = await supabase
      .rpc('get_foreign_keys', { table_name: 'ollama_document_chunks' });
    
    // 3. documents 테이블의 실제 문서 ID 확인
    console.log('📋 documents 테이블 문서 ID 확인');
    const { data: documents, error: docsError } = await supabase
      .from('documents')
      .select('id, title, type')
      .limit(10);
    
    // 4. document_chunks의 document_id 확인
    console.log('📋 document_chunks의 document_id 확인');
    const { data: chunks, error: chunksError } = await supabase
      .from('document_chunks')
      .select('document_id')
      .limit(10);
    
    const result = {
      success: true,
      message: '테이블 제약조건 확인 완료',
      timestamp: new Date().toISOString(),
      analysis: {
        constraints: constraints || [],
        foreignKeys: foreignKeys || [],
        documents: {
          total: documents?.length || 0,
          ids: documents?.map(doc => doc.id) || []
        },
        chunks: {
          total: chunks?.length || 0,
          documentIds: [...new Set(chunks?.map(chunk => chunk.document_id) || [])]
        }
      },
      recommendations: [] as string[]
    };
    
    // 5. 권장사항 생성
    if (foreignKeys && foreignKeys.length > 0) {
      result.recommendations.push('외래키 제약조건이 존재합니다. 데이터 복사 전에 제거해야 합니다.');
    } else {
      result.recommendations.push('외래키 제약조건이 없습니다. 데이터 복사를 진행할 수 있습니다.');
    }
    
    console.log('✅ 테이블 제약조건 확인 완료:', {
      constraints: constraints?.length || 0,
      foreignKeys: foreignKeys?.length || 0,
      documents: documents?.length || 0,
      chunks: chunks?.length || 0
    });
    
    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
  } catch (error) {
    console.error('❌ 테이블 제약조건 확인 실패:', error);
    
    return NextResponse.json({
      success: false,
      error: '테이블 제약조건 확인 중 오류가 발생했습니다.',
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


