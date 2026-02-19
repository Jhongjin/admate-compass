import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    console.log('👑 woolela@nasmedia.co.kr 관리자 권한 부여 시작...');

    const supabaseAdmin = await createClient();
    const woolelaEmail = 'woolela@nasmedia.co.kr';

    const results = {
      auth_user_found: false,
      admin_user_created: false,
      admin_user_updated: false,
      errors: [] as string[]
    };

    // 1. Auth 사용자 확인
    console.log('🔍 Auth 사용자 확인 중...');
    const { data: authUsers, error: authListError } = await supabaseAdmin.auth.admin.listUsers();
    if (authListError) {
      console.error('❌ Auth 사용자 목록 조회 실패:', authListError);
      results.errors.push(`Auth 사용자 목록 조회 실패: ${authListError.message}`);
    } else {
      const woolelaUser = authUsers.users.find(u => u.email === woolelaEmail);
      if (woolelaUser) {
        results.auth_user_found = true;
        console.log(`✅ Auth 사용자 발견: ${woolelaUser.id}`);
      } else {
        results.errors.push('woolela@nasmedia.co.kr Auth 사용자를 찾을 수 없습니다.');
        console.log('❌ Auth 사용자를 찾을 수 없음');
      }
    }

    // 2. 현재 admin_users 상태 확인
    console.log('🔍 현재 관리자 권한 상태 확인 중...');
    const { data: existingAdmin, error: adminCheckError } = await supabaseAdmin
      .from('admin_users')
      .select('*')
      .eq('email', woolelaEmail)
      .single();

    if (adminCheckError && adminCheckError.code !== 'PGRST116') {
      console.error('❌ 관리자 권한 확인 실패:', adminCheckError);
      results.errors.push(`관리자 권한 확인 실패: ${adminCheckError.message}`);
    }

    // 3. 관리자 권한 부여/업데이트
    if (results.auth_user_found) {
      const woolelaUser = authUsers.users.find(u => u.email === woolelaEmail);
      
      if (existingAdmin) {
        // 기존 관리자 권한 업데이트
        console.log('🔄 기존 관리자 권한 업데이트 중...');
        const { error: updateError } = await supabaseAdmin
          .from('admin_users')
          .update({
            is_active: true,
            updated_at: new Date().toISOString()
          })
          .eq('email', woolelaEmail);

        if (updateError) {
          console.error('❌ 관리자 권한 업데이트 실패:', updateError);
          results.errors.push(`관리자 권한 업데이트 실패: ${updateError.message}`);
        } else {
          console.log('✅ 관리자 권한 업데이트 완료');
          results.admin_user_updated = true;
        }
      } else {
        // 새로운 관리자 권한 생성
        console.log('➕ 새로운 관리자 권한 생성 중...');
        const { error: insertError } = await supabaseAdmin
          .from('admin_users')
          .insert({
            user_id: woolelaUser!.id,
            email: woolelaEmail,
            is_active: true,
            granted_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (insertError) {
          console.error('❌ 관리자 권한 생성 실패:', insertError);
          results.errors.push(`관리자 권한 생성 실패: ${insertError.message}`);
        } else {
          console.log('✅ 관리자 권한 생성 완료');
          results.admin_user_created = true;
        }
      }
    }

    // 4. 최종 상태 확인
    console.log('🔍 최종 관리자 권한 상태 확인 중...');
    const { data: finalAdmin, error: finalCheckError } = await supabaseAdmin
      .from('admin_users')
      .select('*')
      .eq('email', woolelaEmail)
      .single();

    const success = results.auth_user_found && 
                   (results.admin_user_created || results.admin_user_updated) && 
                   results.errors.length === 0;

    console.log('✅ woolela@nasmedia.co.kr 관리자 권한 부여 완료');

    return NextResponse.json({
      success: success,
      message: success ? 
        'woolela@nasmedia.co.kr 관리자 권한이 성공적으로 부여되었습니다.' : 
        'woolela@nasmedia.co.kr 관리자 권한 부여 중 오류가 발생했습니다.',
      data: {
        results: results,
        final_admin_status: finalAdmin,
        summary: {
          auth_user_exists: results.auth_user_found,
          admin_privilege_granted: results.admin_user_created || results.admin_user_updated,
          total_errors: results.errors.length,
          operation_success: success
        }
      }
    });

  } catch (error) {
    console.error('❌ woolela@nasmedia.co.kr 관리자 권한 부여 중 오류 발생:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
