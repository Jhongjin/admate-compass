import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest) {
  try {
    console.log('🗑️ adso 사용자 삭제 시작...');

    // Supabase 클라이언트 생성
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    // 1. adso 관련 사용자 찾기 (이메일에 'adso'가 포함된 사용자)
    console.log('🔍 adso 관련 사용자 검색 중...');
    
    // Auth 사용자에서 검색
    const { data: authUsers, error: authListError } = await supabase.auth.admin.listUsers();
    const adsoAuthUsers = authUsers?.users?.filter(user => 
      user.email?.toLowerCase().includes('adso')
    ) || [];

    console.log(`📋 발견된 adso Auth 사용자: ${adsoAuthUsers.length}명`);
    adsoAuthUsers.forEach(user => {
      console.log(`  - ${user.email} (ID: ${user.id})`);
    });

    // 프로필에서 검색
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, name')
      .ilike('email', '%adso%');

    if (profileError) {
      console.error('❌ 프로필 검색 오류:', profileError);
    }

    console.log(`📋 발견된 adso 프로필: ${profiles?.length || 0}명`);
    profiles?.forEach(profile => {
      console.log(`  - ${profile.email} (ID: ${profile.id})`);
    });

    const results = {
      deletedAuthUsers: [] as string[],
      deletedProfiles: [] as string[],
      errors: [] as string[]
    };

    // 2. Auth 사용자 삭제
    for (const authUser of adsoAuthUsers) {
      try {
        console.log(`🗑️ Auth 사용자 삭제 중: ${authUser.email}`);
        
        // 관련 데이터 먼저 삭제
        if (authUser.id) {
          // 대화 기록 삭제
          await supabase
            .from('conversations')
            .delete()
            .eq('user_id', authUser.id);

          // 피드백 기록 삭제
          await supabase
            .from('feedback')
            .delete()
            .eq('user_id', authUser.id);

          // 메시지 기록 삭제
          await supabase
            .from('messages')
            .delete()
            .eq('user_id', authUser.id);

          // 관리자 권한 삭제
          await supabase
            .from('admin_users')
            .delete()
            .eq('user_id', authUser.id);

          // 프로필 삭제
          await supabase
            .from('profiles')
            .delete()
            .eq('id', authUser.id);

          // Auth 사용자 삭제
          const { error: authDeleteError } = await supabase.auth.admin.deleteUser(authUser.id);
          
          if (authDeleteError) {
            console.error(`❌ Auth 사용자 삭제 실패: ${authUser.email}`, authDeleteError);
            results.errors.push(`Auth 사용자 삭제 실패: ${authUser.email} - ${authDeleteError.message}`);
          } else {
            console.log(`✅ Auth 사용자 삭제 완료: ${authUser.email}`);
            results.deletedAuthUsers.push(authUser.email || '');
          }
        }
      } catch (error) {
        console.error(`❌ 사용자 삭제 중 오류: ${authUser.email}`, error);
        results.errors.push(`사용자 삭제 오류: ${authUser.email} - ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      }
    }

    // 3. 프로필만 있는 경우 삭제 (Auth 사용자는 없지만 프로필만 있는 경우)
    if (profiles) {
      for (const profile of profiles) {
        // 이미 Auth 사용자 삭제에서 처리되었는지 확인
        const alreadyDeleted = adsoAuthUsers.some(authUser => authUser.id === profile.id);
        
        if (!alreadyDeleted) {
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
              console.log(`✅ 프로필 삭제 완료: ${profile.email}`);
              results.deletedProfiles.push(profile.email);
            }
          } catch (error) {
            console.error(`❌ 프로필 삭제 중 오류: ${profile.email}`, error);
            results.errors.push(`프로필 삭제 오류: ${profile.email} - ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
          }
        }
      }
    }

    console.log('✅ adso 사용자 삭제 완료');
    console.log(`📊 삭제 결과:`);
    console.log(`  - Auth 사용자: ${results.deletedAuthUsers.length}명`);
    console.log(`  - 프로필: ${results.deletedProfiles.length}명`);
    console.log(`  - 오류: ${results.errors.length}개`);

    return NextResponse.json({
      success: true,
      message: 'adso 사용자 삭제 완료',
      data: {
        deletedAuthUsers: results.deletedAuthUsers,
        deletedProfiles: results.deletedProfiles,
        errors: results.errors,
        summary: {
          totalDeleted: results.deletedAuthUsers.length + results.deletedProfiles.length,
          errorCount: results.errors.length
        }
      }
    });

  } catch (error) {
    console.error('❌ adso 사용자 삭제 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'adso 사용자 삭제 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}
