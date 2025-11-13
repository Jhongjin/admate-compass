import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    console.log('🧪 테스트용 회원가입 시작...');

    const { email, password, name } = await request.json();

    if (!email || !password || !name) {
      return NextResponse.json(
        { success: false, error: '이메일, 비밀번호, 이름이 모두 필요합니다.' },
        { status: 400 }
      );
    }

    // Supabase 클라이언트 생성 (Service Role Key 사용)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    // 1. 이메일 중복 확인
    console.log('📧 이메일 중복 확인 중...');
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const emailExists = existingUsers.users.some(user => user.email === email);
    
    if (emailExists) {
      return NextResponse.json(
        { success: false, error: '이미 등록된 이메일입니다.' },
        { status: 400 }
      );
    }

    // 2. Supabase Auth에 사용자 생성
    console.log('👤 Auth 사용자 생성 중...');
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true, // 이메일 확인 자동 완료
      user_metadata: {
        name: name
      }
    });

    if (authError) {
      console.error('❌ Auth 사용자 생성 오류:', authError);
      return NextResponse.json(
        { success: false, error: `사용자 생성 실패: ${authError.message}` },
        { status: 500 }
      );
    }

    const userId = authData.user.id;
    console.log(`✅ Auth 사용자 생성 완료: ${userId}`);

    // 3. 트리거가 자동으로 profiles 테이블에 데이터를 생성하는지 확인
    console.log('⏳ 트리거 실행 대기 중...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기

    // 4. profiles 테이블 확인
    console.log('📝 프로필 테이블 확인 중...');
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError) {
      console.error('❌ 프로필 확인 오류:', profileError);
      return NextResponse.json(
        { success: false, error: `프로필 확인 실패: ${profileError.message}` },
        { status: 500 }
      );
    }

    console.log('✅ 회원가입 테스트 완료');

    return NextResponse.json({
      success: true,
      message: '회원가입 테스트가 성공적으로 완료되었습니다.',
      data: {
        auth_user: {
          id: authData.user.id,
          email: authData.user.email,
          created_at: authData.user.created_at,
          email_confirmed_at: authData.user.email_confirmed_at
        },
        profile: profile,
        trigger_worked: !!profile
      }
    });

  } catch (error) {
    console.error('❌ 테스트용 회원가입 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '회원가입 테스트 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}








