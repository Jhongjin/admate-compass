import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 상세 동기화 상태 확인 시작...');

    // Supabase 클라이언트 생성 (Service Role Key 사용)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    // 1. Auth 사용자 목록 조회
    console.log('👤 Auth 사용자 목록 조회 중...');
    const { data: authUsers, error: authListError } = await supabase.auth.admin.listUsers();
    
    if (authListError) {
      throw new Error(`Auth 사용자 목록 조회 실패: ${authListError.message}`);
    }

    // 2. Profiles 테이블 조회
    console.log('📝 Profiles 테이블 조회 중...');
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('*');

    if (profileError) {
      throw new Error(`Profiles 조회 실패: ${profileError.message}`);
    }

    // 3. Admin Users 테이블 조회
    console.log('👑 Admin Users 테이블 조회 중...');
    const { data: adminUsers, error: adminError } = await supabase
      .from('admin_users')
      .select('*');

    if (adminError) {
      throw new Error(`Admin Users 조회 실패: ${adminError.message}`);
    }

    // 4. Conversations 테이블 조회
    console.log('💬 Conversations 테이블 조회 중...');
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select('user_id, created_at');

    if (convError) {
      console.log('⚠️ Conversations 조회 실패 (무시):', convError.message);
    }

    // 5. Feedback 테이블 조회
    console.log('👍 Feedback 테이블 조회 중...');
    const { data: feedback, error: feedbackError } = await supabase
      .from('feedback')
      .select('user_id, created_at');

    if (feedbackError) {
      console.log('⚠️ Feedback 조회 실패 (무시):', feedbackError.message);
    }

    // 6. Messages 테이블 조회
    console.log('📨 Messages 테이블 조회 중...');
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('user_id, created_at');

    if (messagesError) {
      console.log('⚠️ Messages 조회 실패 (무시):', messagesError.message);
    }

    // 7. 동기화 문제 분석
    const authUserIds = authUsers?.users?.map(u => u.id) || [];
    const profileIds = profiles?.map(p => p.id) || [];
    const adminUserIds = adminUsers?.map(a => a.user_id) || [];

    // 고아 Auth 사용자 (Auth에는 있지만 Profile이 없는 경우)
    const orphanedAuthUsers = authUsers?.users?.filter(authUser => 
      !profiles?.find(profile => profile.id === authUser.id)
    ) || [];

    // 고아 Profile (Profile에는 있지만 Auth가 없는 경우)
    const orphanedProfiles = profiles?.filter(profile => 
      !authUsers?.users?.find(authUser => authUser.id === profile.id)
    ) || [];

    // 관리자 권한이 있지만 Auth 사용자가 없는 경우
    const orphanedAdminUsers = adminUsers?.filter(adminUser => 
      !authUsers?.users?.find(authUser => authUser.id === adminUser.user_id)
    ) || [];

    // Auth 사용자는 있지만 관리자 권한이 없는 경우 (정상)
    const authUsersWithoutAdmin = authUsers?.users?.filter(authUser => 
      !adminUsers?.find(adminUser => adminUser.user_id === authUser.id)
    ) || [];

    // 8. 관련 데이터 분석
    const conversationUserIds = conversations?.map(c => c.user_id) || [];
    const feedbackUserIds = feedback?.map(f => f.user_id) || [];
    const messageUserIds = messages?.map(m => m.user_id) || [];

    // 관련 데이터가 있지만 Auth 사용자가 없는 경우
    const orphanedConversations = conversationUserIds.filter(userId => 
      !authUserIds.includes(userId)
    );
    const orphanedFeedback = feedbackUserIds.filter(userId => 
      !authUserIds.includes(userId)
    );
    const orphanedMessages = messageUserIds.filter(userId => 
      !authUserIds.includes(userId)
    );

    console.log('✅ 상세 동기화 상태 확인 완료');

    return NextResponse.json({
      success: true,
      message: '상세 동기화 상태 확인이 완료되었습니다.',
      data: {
        summary: {
          total_auth_users: authUsers?.users?.length || 0,
          total_profiles: profiles?.length || 0,
          total_admin_users: adminUsers?.length || 0,
          total_conversations: conversations?.length || 0,
          total_feedback: feedback?.length || 0,
          total_messages: messages?.length || 0
        },
        sync_issues: {
          orphaned_auth_users: {
            count: orphanedAuthUsers.length,
            users: orphanedAuthUsers.map(u => ({
              id: u.id,
              email: u.email,
              created_at: u.created_at
            }))
          },
          orphaned_profiles: {
            count: orphanedProfiles.length,
            profiles: orphanedProfiles.map(p => ({
              id: p.id,
              email: p.email,
              name: p.name,
              created_at: p.created_at
            }))
          },
          orphaned_admin_users: {
            count: orphanedAdminUsers.length,
            admins: orphanedAdminUsers.map(a => ({
              id: a.id,
              user_id: a.user_id,
              email: a.email,
              is_active: a.is_active
            }))
          },
          orphaned_related_data: {
            conversations: orphanedConversations.length,
            feedback: orphanedFeedback.length,
            messages: orphanedMessages.length
          }
        },
        normal_users: {
          auth_users_without_admin: authUsersWithoutAdmin.map(u => ({
            id: u.id,
            email: u.email,
            name: u.user_metadata?.name || 'Unknown'
          }))
        },
        detailed_data: {
          auth_users: authUsers?.users?.map(u => ({
            id: u.id,
            email: u.email,
            created_at: u.created_at,
            email_confirmed_at: u.email_confirmed_at,
            has_profile: profileIds.includes(u.id),
            has_admin: adminUserIds.includes(u.id)
          })) || [],
          profiles: profiles?.map(p => ({
            id: p.id,
            email: p.email,
            name: p.name,
            created_at: p.created_at,
            has_auth: authUserIds.includes(p.id),
            has_admin: adminUserIds.includes(p.id)
          })) || [],
          admin_users: adminUsers?.map(a => ({
            id: a.id,
            user_id: a.user_id,
            email: a.email,
            is_active: a.is_active,
            has_auth: authUserIds.includes(a.user_id),
            has_profile: profileIds.includes(a.user_id)
          })) || []
        }
      }
    });

  } catch (error) {
    console.error('❌ 상세 동기화 상태 확인 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '상세 동기화 상태 확인 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}











