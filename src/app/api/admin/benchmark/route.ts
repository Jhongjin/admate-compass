/**
 * 청킹 성능 벤치마크 API
 * 관리자 전용 - 청킹 성능 테스트
 */

import { NextRequest, NextResponse } from 'next/server';
import { ChunkingBenchmark } from '@/lib/utils/chunkingBenchmark';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5분

export async function POST(request: NextRequest) {
  try {
    const { suiteName, testConfig } = await request.json().catch(() => ({}));

    console.log('🚀 벤치마크 API 시작:', { suiteName, testConfig });

    // 기본 벤치마크 스위트 실행
    const suite = await ChunkingBenchmark.runSuite(
      suiteName || '기본 벤치마크 스위트'
    );

    return NextResponse.json({
      success: true,
      suite,
      export: {
        json: ChunkingBenchmark.exportResults(suite),
        csv: ChunkingBenchmark.exportResultsCSV(suite),
      },
    });
  } catch (error) {
    console.error('❌ 벤치마크 실행 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      },
      { status: 500 }
    );
  }
}

/**
 * 단일 테스트 실행
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const testName = searchParams.get('testName') || '단일 테스트';
    const documentSize = parseInt(searchParams.get('size') || '10000');
    const documentType = (searchParams.get('type') || 'txt') as 'pdf' | 'docx' | 'txt' | 'url';
    const contentType = (searchParams.get('contentType') || 'general') as
      | 'technical'
      | 'marketing'
      | 'policy'
      | 'faq'
      | 'general';

    console.log('🧪 단일 벤치마크 테스트:', {
      testName,
      documentSize,
      documentType,
      contentType,
    });

    const result = await ChunkingBenchmark.runSingleTest(
      testName,
      documentSize,
      documentType,
      contentType,
      {
        chunkSize: 800,
        chunkOverlap: 100,
      }
    );

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error('❌ 단일 테스트 실행 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      },
      { status: 500 }
    );
  }
}

