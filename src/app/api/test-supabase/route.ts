/**
 * Supabase 연결 테스트 API
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Supabase 연결 테스트 시작');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log('📋 환경 변수 상태:');
    console.log('  - NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '설정됨' : '없음');
    console.log('  - SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? '설정됨' : '없음');
    console.log('  - NODE_ENV:', process.env.NODE_ENV);

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({
        success: false,
        error: 'Supabase 환경 변수가 설정되지 않았습니다.',
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          hasSupabaseUrl: !!supabaseUrl,
          hasSupabaseKey: !!supabaseKey,
        }
      });
    }

    // Supabase 클라이언트 생성
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase 클라이언트 생성 성공');

    // 연결 테스트 - documents 테이블 조회
    const { data: documents, error: documentsError } = await supabase
      .from('documents')
      .select('count')
      .limit(1);

    if (documentsError) {
      console.error('❌ documents 테이블 조회 실패:', documentsError);
      return NextResponse.json({
        success: false,
        error: 'Supabase 연결 테스트 실패',
        details: documentsError.message,
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          hasSupabaseUrl: !!supabaseUrl,
          hasSupabaseKey: !!supabaseKey,
        }
      });
    }

    // 연결 테스트 - document_chunks 테이블 조회
    const { data: chunks, error: chunksError } = await supabase
      .from('document_chunks')
      .select('count')
      .limit(1);

    if (chunksError) {
      console.error('❌ document_chunks 테이블 조회 실패:', chunksError);
      return NextResponse.json({
        success: false,
        error: 'document_chunks 테이블 접근 실패',
        details: chunksError.message,
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          hasSupabaseUrl: !!supabaseUrl,
          hasSupabaseKey: !!supabaseKey,
        }
      });
    }

    console.log('✅ Supabase 연결 테스트 성공');

    return NextResponse.json({
      success: true,
      data: {
        message: 'Supabase 연결 성공',
        tables: {
          documents: '접근 가능',
          document_chunks: '접근 가능'
        },
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          hasSupabaseUrl: !!supabaseUrl,
          hasSupabaseKey: !!supabaseKey,
        }
      }
    });

  } catch (error) {
    console.error('❌ Supabase 테스트 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Supabase 테스트 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.stack : String(error)
      },
      { status: 500 }
    );
  }
}
