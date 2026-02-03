import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 환경 변수 확인 및 조건부 클라이언트 생성
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: any = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    console.log('🔍 관리자 권한 확인 요청:', { email });

    if (!email) {
      return NextResponse.json(
        { success: false, error: '이메일이 필요합니다.' },
        { status: 400 }
      );
    }

    // 데이터베이스에서 관리자 권한 확인
    const { data, error } = await supabase
      .from('admin_users')
      .select('is_active')
      .eq('email', email)
      .eq('is_active', true)
      .single();

    const isAdmin = !error && !!data;
    console.log('✅ 관리자 권한 확인 완료 (데이터베이스):', { isAdmin, email, error: error?.message });

    return NextResponse.json({
      success: true,
      isAdmin,
      debug: {
        email: email,
        method: 'database',
        error: error?.message || null
      }
    });

  } catch (error) {
    console.error('❌ 관리자 권한 확인 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '관리자 권한 확인 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}


