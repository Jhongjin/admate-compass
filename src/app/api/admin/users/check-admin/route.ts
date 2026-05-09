import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { guardProductionAdminSessionRoute } from '@/lib/adminDebugGuard';

export async function POST(request: NextRequest) {
  const guardResponse = guardProductionAdminSessionRoute();
  if (guardResponse) return guardResponse;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Supabase 클라이언트 확인
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: '데이터베이스 연결이 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: '이메일이 필요합니다.' },
        { status: 400 }
      );
    }

    // 관리자 권한 확인
    const { data, error } = await supabase
      .from('admin_users')
      .select('is_active')
      .eq('email', email)
      .eq('is_active', true)
      .single();

    if (error) {
      // 관리자가 아닌 경우
      return NextResponse.json({
        success: true,
        isAdmin: false
      });
    }

    return NextResponse.json({
      success: true,
      isAdmin: !!data?.is_active
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


