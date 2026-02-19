import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    console.log('📋 모든 사용자 목록 조회 시작...');

    // Supabase 클라이언트 생성
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    // 1. Auth 사용자 목록 조회
    console.log('🔍 Auth 사용자 목록 조회 중...');
    const { data: authUsers, error: authListError } = await supabase.auth.admin.listUsers();
    
    if (authListError) {
      console.error('❌ Auth 사용자 목록 조회 오류:', authListError);
    }

    // 2. 프로필 목록 조회
    console.log('🔍 프로필 목록 조회 중...');
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, name, created_at');

    if (profileError) {
      console.error('❌ 프로필 목록 조회 오류:', profileError);
    }

    // 3. 관리자 사용자 목록 조회
    console.log('🔍 관리자 사용자 목록 조회 중...');
    const { data: adminUsers, error: adminError } = await supabase
      .from('admin_users')
      .select('user_id, email, is_active, granted_at');

    if (adminError) {
      console.error('❌ 관리자 사용자 목록 조회 오류:', adminError);
    }

    // 4. 데이터 정리 및 매칭
    const authUserList = authUsers?.users?.map(user => ({
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      email_confirmed_at: user.email_confirmed_at,
      last_sign_in_at: user.last_sign_in_at,
      hasProfile: profiles?.some(profile => profile.id === user.id) || false,
      isAdmin: adminUsers?.some(admin => admin.user_id === user.id && admin.is_active) || false
    })) || [];

    const profileList = profiles?.map(profile => ({
      id: profile.id,
      email: profile.email,
      name: profile.name,
      created_at: profile.created_at,
      hasAuth: authUsers?.users?.some(user => user.id === profile.id) || false,
      isAdmin: adminUsers?.some(admin => admin.user_id === profile.id && admin.is_active) || false
    })) || [];

    // 5. 고아 데이터 찾기
    const orphanedAuthUsers = authUserList.filter(user => !user.hasProfile);
    const orphanedProfiles = profileList.filter(profile => !profile.hasAuth);

    console.log(`📊 사용자 현황:`);
    console.log(`  - Auth 사용자: ${authUserList.length}명`);
    console.log(`  - 프로필: ${profileList.length}명`);
    console.log(`  - 관리자: ${adminUsers?.length || 0}명`);
    console.log(`  - 고아 Auth 사용자: ${orphanedAuthUsers.length}명`);
    console.log(`  - 고아 프로필: ${orphanedProfiles.length}명`);

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalAuthUsers: authUserList.length,
          totalProfiles: profileList.length,
          totalAdmins: adminUsers?.length || 0,
          orphanedAuthUsers: orphanedAuthUsers.length,
          orphanedProfiles: orphanedProfiles.length
        },
        authUsers: authUserList,
        profiles: profileList,
        adminUsers: adminUsers || [],
        orphanedAuthUsers,
        orphanedProfiles
      }
    });

  } catch (error) {
    console.error('❌ 사용자 목록 조회 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '사용자 목록 조회 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}
