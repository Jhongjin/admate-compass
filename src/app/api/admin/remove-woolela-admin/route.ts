import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest) {
  try {
    console.log('🗑️ woolela@nasmedia.co.kr 관리자 권한 제거 시작...');

    // Supabase 클라이언트 생성
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    const woolelaUserId = 'f93acd33-61c4-4f22-8766-6adabd5f9f18';
    const woolelaEmail = 'woolela@nasmedia.co.kr';

    // 관리자 권한 제거
    console.log('👑 woolela 관리자 권한 제거 중...');
    const { error: adminDeleteError } = await supabase
      .from('admin_users')
      .delete()
      .eq('user_id', woolelaUserId);

    if (adminDeleteError) {
      console.error('❌ 관리자 권한 제거 오류:', adminDeleteError);
      throw new Error(`관리자 권한 제거 실패: ${adminDeleteError.message}`);
    }

    console.log('✅ woolela 관리자 권한 제거 완료');

    return NextResponse.json({
      success: true,
      message: 'woolela@nasmedia.co.kr의 관리자 권한이 제거되었습니다.',
      data: {
        user: {
          id: woolelaUserId,
          email: woolelaEmail,
          is_admin: false
        }
      }
    });

  } catch (error) {
    console.error('❌ woolela 관리자 권한 제거 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'woolela 관리자 권한 제거 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}
