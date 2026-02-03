import { NextRequest, NextResponse } from 'next/server';
import { RAGSearchService } from '@/lib/services/RAGSearchService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, options = {} } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: '검색 쿼리가 필요합니다.' },
        { status: 400 }
      );
    }

    console.log('검색 요청:', { query, options });

    // 문서 검색 실행
    const ragSearchService = new RAGSearchService();
    const results = await ragSearchService.searchSimilarChunks(
      query,
      options.matchCount || 10,
      options.matchThreshold || 0.7
    );

    return NextResponse.json({
      success: true,
      data: {
        query,
        results,
        totalResults: results.length,
        searchOptions: options
      }
    });

  } catch (error) {
    console.error('검색 오류:', error);
    return NextResponse.json(
      { 
        error: '검색 처리 중 오류가 발생했습니다.',
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
    const matchThreshold = parseFloat(searchParams.get('threshold') || '0.7');
    const matchCount = parseInt(searchParams.get('limit') || '10');
    const documentTypes = searchParams.get('types')?.split(',');

    if (!query) {
      return NextResponse.json(
        { error: '검색 쿼리(q)가 필요합니다.' },
        { status: 400 }
      );
    }

    console.log('검색 요청 (GET):', { query, matchThreshold, matchCount, documentTypes });

    // 문서 검색 실행
    const ragSearchService = new RAGSearchService();
    const results = await ragSearchService.searchSimilarChunks(
      query,
      matchCount,
      matchThreshold
    );

    return NextResponse.json({
      success: true,
      data: {
        query,
        results,
        totalResults: results.length,
        searchOptions: {
          matchThreshold,
          matchCount,
          documentTypes
        }
      }
    });

  } catch (error) {
    console.error('검색 오류:', error);
    return NextResponse.json(
      { 
        error: '검색 처리 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}