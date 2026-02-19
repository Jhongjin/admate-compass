/**
 * RAG 처리 테스트 API
 * 단계별로 RAG 처리 과정을 테스트
 */

import { NextRequest, NextResponse } from 'next/server';
import { ragProcessor, DocumentData } from '@/lib/services/RAGProcessor';

export async function POST(request: NextRequest) {
  try {
    console.log('🧪 RAG 처리 테스트 시작');

    // 테스트 문서 생성
    const testDocument: DocumentData = {
      id: `test_${Date.now()}`,
      title: 'test.txt',
      content: '이것은 테스트 문서입니다. RAG 처리가 정상적으로 작동하는지 확인하기 위한 내용입니다.',
      type: 'file',
      file_size: 100,
      file_type: 'text/plain',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('📄 테스트 문서:', testDocument);

    // RAG 처리 실행
    const result = await ragProcessor.processDocument(testDocument);

    console.log('🧪 RAG 처리 결과:', result);

    return NextResponse.json({
      success: true,
      data: {
        testDocument,
        result,
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        }
      }
    });

  } catch (error) {
    console.error('❌ RAG 테스트 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'RAG 테스트 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.stack : String(error)
      },
      { status: 500 }
    );
  }
}
