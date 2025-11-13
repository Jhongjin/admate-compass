import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    console.log('🗑️ woolela@nasmedia.co.kr Auth 사용자 삭제 시작...');

    // Supabase 클라이언트 생성 (Service Role Key 사용)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    const woolelaEmail = 'woolela@nasmedia.co.kr';
    const woolelaUserId = '6e9906b2-6e93-42ed-ad66-d47d626f8fc2';

    // 1. Auth 사용자 찾기
    console.log('🔍 Auth 사용자 찾는 중...');
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const authUser = authUsers?.users?.find(u => u.email === woolelaEmail);
    
    if (!authUser) {
      console.log('ℹ️ Auth 사용자를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.');
      return NextResponse.json({
        success: true,
        message: 'Auth 사용자가 이미 삭제되었거나 존재하지 않습니다.',
        data: {
          user_found: false,
          user_id: woolelaUserId,
          email: woolelaEmail
        }
      });
    }

    console.log(`👤 Auth 사용자 발견: ${authUser.id}`);

    // 2. Auth 사용자 삭제
    console.log('🗑️ Auth 사용자 삭제 중...');
    const { error: deleteError } = await supabase.auth.admin.deleteUser(authUser.id);

    if (deleteError) {
      console.error('❌ Auth 사용자 삭제 실패:', deleteError);
      return NextResponse.json(
        {
          success: false,
          error: `Auth 사용자 삭제 실패: ${deleteError.message}`,
          data: {
            user_id: authUser.id,
            email: woolelaEmail,
            error_details: deleteError
          }
        },
        { status: 500 }
      );
    }

    console.log('✅ Auth 사용자 삭제 완료');

    // 3. 삭제 후 확인
    console.log('🔍 삭제 후 상태 확인 중...');
    const { data: authUsersAfter } = await supabase.auth.admin.listUsers();
    const authUserAfter = authUsersAfter?.users?.find(u => u.email === woolelaEmail);

    return NextResponse.json({
      success: true,
      message: 'woolela@nasmedia.co.kr Auth 사용자 삭제가 완료되었습니다.',
      data: {
        deleted_user: {
          id: authUser.id,
          email: authUser.email,
          created_at: authUser.created_at
        },
        deletion_confirmed: !authUserAfter,
        remaining_auth_users: authUsersAfter?.users?.length || 0
      }
    });

  } catch (error) {
    console.error('❌ woolela@nasmedia.co.kr Auth 사용자 삭제 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'woolela@nasmedia.co.kr Auth 사용자 삭제 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}








