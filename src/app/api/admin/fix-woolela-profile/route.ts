import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    console.log('🔧 woolela 프로필 수동 생성 시작...');

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

    // 1. 기존 프로필 삭제 (있다면)
    console.log('🗑️ 기존 프로필 확인 및 삭제 중...');
    try {
      await supabase
        .from('profiles')
        .delete()
        .eq('id', woolelaUserId);
      console.log('✅ 기존 프로필 정리 완료');
    } catch (error) {
      console.log('⚠️ 기존 프로필 정리 중 오류 (무시):', error);
    }

    // 2. 프로필 생성
    console.log('📝 woolela 프로필 생성 중...');
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: woolelaUserId,
        email: woolelaEmail,
        name: '우렐라',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (profileError) {
      console.error('❌ 프로필 생성 오류:', profileError);
      throw new Error(`프로필 생성 실패: ${profileError.message}`);
    }

    console.log('✅ woolela 프로필 생성 완료');

    // 3. 관리자 권한 확인
    console.log('👑 관리자 권한 확인 중...');
    const { data: existingAdmin, error: adminCheckError } = await supabase
      .from('admin_users')
      .select('*')
      .eq('user_id', woolelaUserId)
      .single();

    if (adminCheckError && adminCheckError.code !== 'PGRST116') {
      console.error('❌ 관리자 권한 확인 오류:', adminCheckError);
    }

    if (!existingAdmin) {
      console.log('👑 관리자 권한 부여 중...');
      const { error: adminError } = await supabase
        .from('admin_users')
        .insert({
          user_id: woolelaUserId,
          email: woolelaEmail,
          is_active: true,
          granted_at: new Date().toISOString()
        });

      if (adminError) {
        console.error('❌ 관리자 권한 부여 오류:', adminError);
        console.warn('⚠️ 관리자 권한 부여 실패했지만 프로필은 생성됨');
      } else {
        console.log('✅ 관리자 권한 부여 완료');
      }
    } else {
      console.log('✅ 관리자 권한 이미 존재함');
    }

    console.log('✅ woolela 계정 복구 완료');

    return NextResponse.json({
      success: true,
      message: 'woolela 계정이 성공적으로 복구되었습니다.',
      data: {
        user: {
          id: woolelaUserId,
          email: woolelaEmail,
          name: '우렐라',
          is_admin: true,
          is_active: true
        }
      }
    });

  } catch (error) {
    console.error('❌ woolela 프로필 수동 생성 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'woolela 프로필 수동 생성 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}
