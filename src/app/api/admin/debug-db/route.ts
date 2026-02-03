import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 데이터베이스 디버깅 시작...');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase 환경변수가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 모든 문서 조회
    const { data: allDocs, error: allDocsError } = await supabase
      .from('documents')
      .select('id, title, url, status, type, created_at')
      .order('created_at', { ascending: false });

    if (allDocsError) {
      console.error('❌ 모든 문서 조회 실패:', allDocsError);
      return NextResponse.json(
        { error: '문서 조회 실패', details: allDocsError },
        { status: 500 }
      );
    }

    console.log('📋 데이터베이스의 모든 문서:', allDocs);

    // Meta 관련 문서들 필터링
    const metaDocs = allDocs.filter(doc => 
      doc.url && (
        doc.url.includes('facebook.com') || 
        doc.url.includes('instagram.com') || 
        doc.url.includes('meta.com') ||
        doc.url.includes('developers.facebook.com') ||
        doc.url.includes('business.instagram.com')
      )
    );

    console.log('🎯 Meta 관련 문서들:', metaDocs);

    // 각 문서의 청크 수 확인
    const docsWithChunks = [];
    for (const doc of metaDocs) {
      const { data: chunks, error: chunksError } = await supabase
        .from('document_chunks')
        .select('id')
        .eq('document_id', doc.id);

      docsWithChunks.push({
        ...doc,
        chunkCount: chunksError ? 0 : chunks.length
      });
    }

    return NextResponse.json({
      success: true,
      totalDocuments: allDocs.length,
      metaDocuments: metaDocs.length,
      allDocuments: allDocs,
      metaDocumentsWithChunks: docsWithChunks
    });

  } catch (error) {
    console.error('❌ 데이터베이스 디버깅 오류:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: '데이터베이스 디버깅 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

