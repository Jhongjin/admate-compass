import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 데이터베이스 스키마 확인 시작...');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase 환경변수가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // document_chunks 테이블의 실제 구조 확인
    const { data: chunks, error: chunksError } = await supabase
      .from('document_chunks')
      .select('*')
      .limit(1);

    if (chunksError) {
      console.error('❌ document_chunks 조회 실패:', chunksError);
      return NextResponse.json(
        { error: 'document_chunks 조회 실패', details: chunksError },
        { status: 500 }
      );
    }

    console.log('📋 document_chunks 테이블 구조:', chunks.length > 0 ? Object.keys(chunks[0]) : '테이블이 비어있음');

    // documents 테이블의 실제 구조 확인
    const { data: docs, error: docsError } = await supabase
      .from('documents')
      .select('*')
      .limit(1);

    if (docsError) {
      console.error('❌ documents 조회 실패:', docsError);
      return NextResponse.json(
        { error: 'documents 조회 실패', details: docsError },
        { status: 500 }
      );
    }

    console.log('📋 documents 테이블 구조:', docs.length > 0 ? Object.keys(docs[0]) : '테이블이 비어있음');

    return NextResponse.json({
      success: true,
      documentChunksSchema: chunks.length > 0 ? Object.keys(chunks[0]) : [],
      documentsSchema: docs.length > 0 ? Object.keys(docs[0]) : [],
      sampleChunk: chunks.length > 0 ? chunks[0] : null,
      sampleDocument: docs.length > 0 ? docs[0] : null
    });

  } catch (error) {
    console.error('❌ 스키마 확인 오류:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: '스키마 확인 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

