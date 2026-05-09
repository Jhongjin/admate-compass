import { NextRequest, NextResponse } from 'next/server';
import { createCompassServiceClient } from '@/lib/supabase/compass';

export async function POST(request: NextRequest) {
  try {
    console.log('🔍 간단한 검색 테스트 시작');

    const body = await request.json();
    const { query } = body;

    if (!query) {
      return NextResponse.json({
        success: false,
        error: '검색 쿼리가 필요합니다.'
      }, { status: 400 });
    }

    // Supabase 클라이언트 생성
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({
        success: false,
        error: 'Supabase 환경 변수가 설정되지 않았습니다.'
      }, { status: 500 });
    }

    const supabase = createCompassServiceClient();

    // 1. 모든 청크 조회
    console.log('📊 모든 청크 조회');
    const { data: allChunks, error: allError } = await supabase
      .from('document_chunks')
      .select('chunk_id, content, metadata, embedding')
      .limit(10);

    if (allError) {
      console.error('❌ 모든 청크 조회 오류:', allError);
      return NextResponse.json({
        success: false,
        error: '청크 조회 실패',
        details: allError
      }, { status: 500 });
    }

    // 2. 키워드 검색
    console.log('🔍 키워드 검색:', query);
    const keywords = query.toLowerCase().split(' ').filter((word: string) => word.length > 2);
    console.log('🔍 추출된 키워드:', keywords);

    let keywordResults: any[] = [];
    if (keywords.length > 0) {
      const { data: keywordData, error: keywordError } = await supabase
        .from('document_chunks')
        .select('chunk_id, content, metadata, embedding')
        .or(keywords.map((keyword: string) => `content.ilike.%${keyword}%`).join(','))
        .limit(5);

      if (keywordError) {
        console.error('❌ 키워드 검색 오류:', keywordError);
      } else {
        keywordResults = keywordData || [];
        console.log(`📊 키워드 검색 결과: ${keywordResults.length}개`);
      }
    }

    // 3. 결과 정리
    const result = {
      success: true,
      query,
      allChunks: {
        count: allChunks?.length || 0,
        samples: allChunks?.slice(0, 3).map(chunk => ({
          chunk_id: chunk.chunk_id,
          content_preview: chunk.content?.substring(0, 100) + '...',
          has_embedding: !!chunk.embedding,
          metadata: chunk.metadata
        })) || []
      },
      keywordSearch: {
        keywords,
        count: keywordResults.length,
        results: keywordResults.map(chunk => ({
          chunk_id: chunk.chunk_id,
          content_preview: chunk.content?.substring(0, 100) + '...',
          has_embedding: !!chunk.embedding,
          metadata: chunk.metadata
        }))
      },
      timestamp: new Date().toISOString()
    };

    console.log('✅ 간단한 검색 테스트 완료:', {
      allChunksCount: allChunks?.length || 0,
      keywordResultsCount: keywordResults.length
    });

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('❌ 간단한 검색 테스트 실패:', error);

    return NextResponse.json({
      success: false,
      error: '간단한 검색 테스트 중 오류가 발생했습니다.',
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


