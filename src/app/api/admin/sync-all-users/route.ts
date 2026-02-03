import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 전체 사용자 데이터 동기화 시작...');

    // Supabase 클라이언트 생성
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    const results = {
      fixedOrphanedAuth: [] as string[],
      fixedOrphanedProfiles: [] as string[],
      fixedAdminPermissions: [] as string[],
      errors: [] as string[]
    };

    // 1. Auth 사용자 목록 조회
    console.log('🔍 Auth 사용자 목록 조회 중...');
    const { data: authUsers, error: authListError } = await supabase.auth.admin.listUsers();
    
    if (authListError) {
      throw new Error(`Auth 사용자 목록 조회 실패: ${authListError.message}`);
    }

    // 2. 프로필 목록 조회
    console.log('🔍 프로필 목록 조회 중...');
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, name');

    if (profileError) {
      throw new Error(`프로필 목록 조회 실패: ${profileError.message}`);
    }

    // 3. 관리자 사용자 목록 조회
    console.log('🔍 관리자 사용자 목록 조회 중...');
    const { data: adminUsers, error: adminError } = await supabase
      .from('admin_users')
      .select('user_id, email, is_active');

    if (adminError) {
      throw new Error(`관리자 사용자 목록 조회 실패: ${adminError.message}`);
    }

    const profileIds = profiles?.map(p => p.id) || [];
    const adminUserIds = adminUsers?.map(a => a.user_id) || [];

    console.log(`📊 동기화 전 상태:`);
    console.log(`  - Auth 사용자: ${authUsers?.users?.length || 0}명`);
    console.log(`  - 프로필: ${profiles?.length || 0}명`);
    console.log(`  - 관리자: ${adminUsers?.length || 0}명`);

    // 4. 고아 Auth 사용자 처리 (Auth는 있지만 프로필이 없는 경우)
    console.log('🔧 고아 Auth 사용자 처리 중...');
    for (const authUser of authUsers?.users || []) {
      if (!profileIds.includes(authUser.id)) {
        try {
          console.log(`📝 프로필 생성 중: ${authUser.email}`);
          
          // 프로필 생성
          const { error: profileCreateError } = await supabase
            .from('profiles')
            .insert({
              id: authUser.id,
              email: authUser.email || '',
              name: authUser.user_metadata?.name || authUser.email?.split('@')[0] || '사용자',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });

          if (profileCreateError) {
            console.error(`❌ 프로필 생성 실패: ${authUser.email}`, profileCreateError);
            results.errors.push(`프로필 생성 실패: ${authUser.email} - ${profileCreateError.message}`);
          } else {
            console.log(`✅ 프로필 생성 완료: ${authUser.email}`);
            results.fixedOrphanedAuth.push(authUser.email || '');
          }
        } catch (error) {
          console.error(`❌ 프로필 생성 중 오류: ${authUser.email}`, error);
          results.errors.push(`프로필 생성 오류: ${authUser.email} - ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
        }
      }
    }

    // 5. 고아 프로필 처리 (프로필은 있지만 Auth가 없는 경우)
    console.log('🔧 고아 프로필 처리 중...');
    for (const profile of profiles || []) {
      const hasAuth = authUsers?.users?.some(user => user.id === profile.id);
      if (!hasAuth) {
        try {
          console.log(`🗑️ 고아 프로필 삭제 중: ${profile.email}`);
          
          // 관련 데이터 삭제
          await supabase
            .from('conversations')
            .delete()
            .eq('user_id', profile.id);

          await supabase
            .from('feedback')
            .delete()
            .eq('user_id', profile.id);

          await supabase
            .from('messages')
            .delete()
            .eq('user_id', profile.id);

          await supabase
            .from('admin_users')
            .delete()
            .eq('user_id', profile.id);

          // 프로필 삭제
          const { error: profileDeleteError } = await supabase
            .from('profiles')
            .delete()
            .eq('id', profile.id);

          if (profileDeleteError) {
            console.error(`❌ 프로필 삭제 실패: ${profile.email}`, profileDeleteError);
            results.errors.push(`프로필 삭제 실패: ${profile.email} - ${profileDeleteError.message}`);
          } else {
            console.log(`✅ 고아 프로필 삭제 완료: ${profile.email}`);
            results.fixedOrphanedProfiles.push(profile.email);
          }
        } catch (error) {
          console.error(`❌ 프로필 삭제 중 오류: ${profile.email}`, error);
          results.errors.push(`프로필 삭제 오류: ${profile.email} - ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
        }
      }
    }

    // 6. 관리자 권한 동기화
    console.log('🔧 관리자 권한 동기화 중...');
    for (const authUser of authUsers?.users || []) {
      const hasProfile = profileIds.includes(authUser.id);
      const hasAdminPermission = adminUserIds.includes(authUser.id);
      
      // 프로필이 있고 관리자 권한이 없는 경우, 관리자 권한 부여
      if (hasProfile && !hasAdminPermission) {
        try {
          console.log(`👑 관리자 권한 부여 중: ${authUser.email}`);
          
          const { error: adminCreateError } = await supabase
            .from('admin_users')
            .insert({
              user_id: authUser.id,
              email: authUser.email || '',
              is_active: true,
              granted_at: new Date().toISOString()
            });

          if (adminCreateError) {
            console.error(`❌ 관리자 권한 부여 실패: ${authUser.email}`, adminCreateError);
            results.errors.push(`관리자 권한 부여 실패: ${authUser.email} - ${adminCreateError.message}`);
          } else {
            console.log(`✅ 관리자 권한 부여 완료: ${authUser.email}`);
            results.fixedAdminPermissions.push(authUser.email || '');
          }
        } catch (error) {
          console.error(`❌ 관리자 권한 부여 중 오류: ${authUser.email}`, error);
          results.errors.push(`관리자 권한 부여 오류: ${authUser.email} - ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
        }
      }
    }

    console.log('✅ 전체 사용자 데이터 동기화 완료');
    console.log(`📊 동기화 결과:`);
    console.log(`  - 고아 Auth 사용자 복구: ${results.fixedOrphanedAuth.length}명`);
    console.log(`  - 고아 프로필 삭제: ${results.fixedOrphanedProfiles.length}명`);
    console.log(`  - 관리자 권한 부여: ${results.fixedAdminPermissions.length}명`);
    console.log(`  - 오류: ${results.errors.length}개`);

    return NextResponse.json({
      success: true,
      message: '전체 사용자 데이터 동기화 완료',
      data: {
        fixedOrphanedAuth: results.fixedOrphanedAuth,
        fixedOrphanedProfiles: results.fixedOrphanedProfiles,
        fixedAdminPermissions: results.fixedAdminPermissions,
        errors: results.errors,
        summary: {
          totalFixed: results.fixedOrphanedAuth.length + results.fixedOrphanedProfiles.length + results.fixedAdminPermissions.length,
          errorCount: results.errors.length
        }
      }
    });

  } catch (error) {
    console.error('❌ 전체 사용자 데이터 동기화 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '전체 사용자 데이터 동기화 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}
