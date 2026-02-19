import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 올바른 사용자 데이터 동기화 시작...');

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
      removedIncorrectAdmins: [] as string[],
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

    // 6. 잘못된 관리자 권한 제거 (프로필이 없는 사용자의 관리자 권한)
    console.log('🔧 잘못된 관리자 권한 정리 중...');
    for (const adminUser of adminUsers || []) {
      const hasProfile = profileIds.includes(adminUser.user_id);
      if (!hasProfile) {
        try {
          console.log(`🗑️ 잘못된 관리자 권한 제거 중: ${adminUser.email}`);
          
          const { error: adminDeleteError } = await supabase
            .from('admin_users')
            .delete()
            .eq('user_id', adminUser.user_id);

          if (adminDeleteError) {
            console.error(`❌ 관리자 권한 제거 실패: ${adminUser.email}`, adminDeleteError);
            results.errors.push(`관리자 권한 제거 실패: ${adminUser.email} - ${adminDeleteError.message}`);
          } else {
            console.log(`✅ 잘못된 관리자 권한 제거 완료: ${adminUser.email}`);
            results.removedIncorrectAdmins.push(adminUser.email);
          }
        } catch (error) {
          console.error(`❌ 관리자 권한 제거 중 오류: ${adminUser.email}`, error);
          results.errors.push(`관리자 권한 제거 오류: ${adminUser.email} - ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
        }
      }
    }

    console.log('✅ 올바른 사용자 데이터 동기화 완료');
    console.log(`📊 동기화 결과:`);
    console.log(`  - 고아 Auth 사용자 복구: ${results.fixedOrphanedAuth.length}명`);
    console.log(`  - 고아 프로필 삭제: ${results.fixedOrphanedProfiles.length}명`);
    console.log(`  - 잘못된 관리자 권한 제거: ${results.removedIncorrectAdmins.length}명`);
    console.log(`  - 오류: ${results.errors.length}개`);

    return NextResponse.json({
      success: true,
      message: '올바른 사용자 데이터 동기화 완료',
      data: {
        fixedOrphanedAuth: results.fixedOrphanedAuth,
        fixedOrphanedProfiles: results.fixedOrphanedProfiles,
        removedIncorrectAdmins: results.removedIncorrectAdmins,
        errors: results.errors,
        summary: {
          totalFixed: results.fixedOrphanedAuth.length + results.fixedOrphanedProfiles.length + results.removedIncorrectAdmins.length,
          errorCount: results.errors.length
        }
      }
    });

  } catch (error) {
    console.error('❌ 올바른 사용자 데이터 동기화 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '올바른 사용자 데이터 동기화 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}
