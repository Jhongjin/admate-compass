/**
 * RAG 검색 API
 * 벡터 유사도 검색을 통해 관련 문서 청크를 반환
 */

import { NextRequest, NextResponse } from 'next/server';
import { ragProcessor } from '@/lib/services/RAGProcessor';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, limit = 5 } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { success: false, error: '검색 쿼리가 필요합니다.' },
        { status: 400 }
      );
    }

    console.log('🔍 RAG 검색 요청:', { query, limit });

    // 벡터 검색 수행
    const searchResults = await ragProcessor.searchSimilarChunks(query, limit);

    console.log('✅ RAG 검색 완료:', searchResults.length, '개 결과');

    return NextResponse.json({
      success: true,
      data: {
        query,
        results: searchResults,
        count: searchResults.length
      }
    });

  } catch (error) {
    console.error('❌ RAG 검색 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '검색 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const limit = parseInt(searchParams.get('limit') || '5');

    if (!query) {
      return NextResponse.json(
        { success: false, error: '검색 쿼리(q) 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    console.log('🔍 RAG 검색 요청 (GET):', { query, limit });

    // 벡터 검색 수행
    const searchResults = await ragProcessor.searchSimilarChunks(query, limit);

    console.log('✅ RAG 검색 완료:', searchResults.length, '개 결과');

    return NextResponse.json({
      success: true,
      data: {
        query,
        results: searchResults,
        count: searchResults.length
      }
    });

  } catch (error) {
    console.error('❌ RAG 검색 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '검색 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

