import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 사용자 상태 확인 시작...');

    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { success: false, error: '이메일 파라미터가 필요합니다.' },
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

    // 1. Auth 사용자 확인
    console.log('👤 Auth 사용자 확인 중...');
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const authUser = existingUsers.users.find(u => u.email === email);

    // 2. Profiles 테이블 확인
    console.log('📝 Profiles 테이블 확인 중...');
    let profile = null;
    if (authUser) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();
      profile = profileData;
    }

    // 3. Admin Users 테이블 확인
    console.log('👑 Admin Users 테이블 확인 중...');
    let adminUser = null;
    if (authUser) {
      const { data: adminData } = await supabase
        .from('admin_users')
        .select('*')
        .eq('user_id', authUser.id)
        .single();
      adminUser = adminData;
    }

    // 4. 관련 데이터 확인
    console.log('📊 관련 데이터 확인 중...');
    let conversations: any[] = [];
    let feedback: any[] = [];
    let messages: any[] = [];

    if (authUser) {
      const { data: convData } = await supabase
        .from('conversations')
        .select('id, created_at')
        .eq('user_id', authUser.id);
      conversations = convData || [];

      const { data: feedbackData } = await supabase
        .from('feedback')
        .select('id, created_at')
        .eq('user_id', authUser.id);
      feedback = feedbackData || [];

      const { data: messagesData } = await supabase
        .from('messages')
        .select('id, created_at')
        .eq('user_id', authUser.id);
      messages = messagesData || [];
    }

    console.log('✅ 사용자 상태 확인 완료');

    return NextResponse.json({
      success: true,
      message: '사용자 상태 확인이 완료되었습니다.',
      data: {
        email: email,
        auth_user: authUser ? {
          id: authUser.id,
          email: authUser.email,
          created_at: authUser.created_at,
          email_confirmed_at: authUser.email_confirmed_at,
          user_metadata: authUser.user_metadata
        } : null,
        profile: profile,
        admin_user: adminUser,
        related_data: {
          conversations_count: conversations.length,
          feedback_count: feedback.length,
          messages_count: messages.length,
          conversations: conversations,
          feedback: feedback,
          messages: messages
        },
        status_summary: {
          exists_in_auth: !!authUser,
          exists_in_profiles: !!profile,
          exists_in_admin: !!adminUser,
          has_related_data: conversations.length > 0 || feedback.length > 0 || messages.length > 0,
          data_consistency: authUser ? (!!profile === true) : true
        }
      }
    });

  } catch (error) {
    console.error('❌ 사용자 상태 확인 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '사용자 상태 확인 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔍 전체 사용자 목록 확인 시작...');

    // Supabase 클라이언트 생성 (Service Role Key 사용)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    // 1. 모든 Auth 사용자 조회
    console.log('👤 모든 Auth 사용자 조회 중...');
    const { data: authUsers } = await supabase.auth.admin.listUsers();

    // 2. 모든 Profiles 조회
    console.log('📝 모든 Profiles 조회 중...');
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*');

    // 3. 모든 Admin Users 조회
    console.log('👑 모든 Admin Users 조회 중...');
    const { data: adminUsers } = await supabase
      .from('admin_users')
      .select('*');

    console.log('✅ 전체 사용자 목록 확인 완료');

    return NextResponse.json({
      success: true,
      message: '전체 사용자 목록 확인이 완료되었습니다.',
      data: {
        auth_users: authUsers.users.map(user => ({
          id: user.id,
          email: user.email,
          created_at: user.created_at,
          email_confirmed_at: user.email_confirmed_at,
          user_metadata: user.user_metadata
        })),
        profiles: profiles || [],
        admin_users: adminUsers || [],
        summary: {
          total_auth_users: authUsers.users.length,
          total_profiles: profiles?.length || 0,
          total_admin_users: adminUsers?.length || 0,
          orphaned_auth_users: authUsers.users.filter(authUser => 
            !profiles?.find(profile => profile.id === authUser.id)
          ).length,
          orphaned_profiles: profiles?.filter(profile => 
            !authUsers.users.find(authUser => authUser.id === profile.id)
          ).length || 0
        }
      }
    });

  } catch (error) {
    console.error('❌ 전체 사용자 목록 확인 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '전체 사용자 목록 확인 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}
