import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest) {
  try {
    console.log('🧹 고아 사용자 정리 시작...');

    // Supabase 클라이언트 생성
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    // 1. 고아 Auth 사용자 찾기
    const { data: authUsers, error: authListError } = await supabase.auth.admin.listUsers();
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id');

    if (authListError || profileError) {
      throw new Error('사용자 목록 조회 실패');
    }

    const profileIds = profiles?.map(p => p.id) || [];
    const orphanedAuthUsers = authUsers?.users?.filter(user => 
      !profileIds.includes(user.id)
    ) || [];

    console.log(`🔍 발견된 고아 Auth 사용자: ${orphanedAuthUsers.length}명`);

    const results = {
      deletedUsers: [] as string[],
      errors: [] as string[]
    };

    // 2. 고아 Auth 사용자 삭제
    for (const user of orphanedAuthUsers) {
      try {
        console.log(`🗑️ 고아 Auth 사용자 삭제 중: ${user.email}`);
        
        // 관련 데이터 삭제
        await supabase
          .from('conversations')
          .delete()
          .eq('user_id', user.id);

        await supabase
          .from('feedback')
          .delete()
          .eq('user_id', user.id);

        await supabase
          .from('messages')
          .delete()
          .eq('user_id', user.id);

        await supabase
          .from('admin_users')
          .delete()
          .eq('user_id', user.id);

        // Auth 사용자 삭제
        const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
        
        if (deleteError) {
          console.error(`❌ 삭제 실패: ${user.email}`, deleteError);
          results.errors.push(`${user.email}: ${deleteError.message}`);
        } else {
          console.log(`✅ 삭제 완료: ${user.email}`);
          results.deletedUsers.push(user.email || '');
        }
      } catch (error) {
        console.error(`❌ 삭제 중 오류: ${user.email}`, error);
        results.errors.push(`${user.email}: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      }
    }

    console.log(`✅ 고아 사용자 정리 완료: ${results.deletedUsers.length}명 삭제`);

    return NextResponse.json({
      success: true,
      message: '고아 사용자 정리 완료',
      data: {
        deletedUsers: results.deletedUsers,
        errors: results.errors,
        summary: {
          totalDeleted: results.deletedUsers.length,
          errorCount: results.errors.length
        }
      }
    });

  } catch (error) {
    console.error('❌ 고아 사용자 정리 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '고아 사용자 정리 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}
