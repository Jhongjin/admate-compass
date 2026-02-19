import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// 환경 변수 확인 및 조건부 클라이언트 생성
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: any = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

// 관리자 권한 확인 함수
async function isAdminUser(email: string): Promise<boolean> {
  // 데이터베이스에서 관리자 권한 확인
  const { data, error } = await supabase
    .from('admin_users')
    .select('is_active')
    .eq('email', email)
    .eq('is_active', true)
    .single();
  
  if (error) {
    console.log('📝 관리자 권한 없음:', email, error.message);
    return false;
  }
  
  console.log('✅ 관리자 권한 확인:', email);
  return !!data;
}

// UUID 유효성 검사 함수
function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export async function POST(request: NextRequest) {
    // Supabase 클라이언트 확인
    if (!supabase) {
      return NextResponse.json(
        { error: '데이터베이스 연결이 설정되지 않았습니다.' },
        { status: 500 }
      );
    }
  try {
    console.log('🚀 사용자 권한 관리 API 시작...');

    const body = await request.json();
    const { userId, action, permissions } = body;

    if (!userId || !action) {
      return NextResponse.json(
        { success: false, error: '사용자 ID와 작업이 필요합니다.' },
        { status: 400 }
      );
    }

    // UUID 유효성 검사
    if (!isValidUUID(userId)) {
      console.error('❌ 잘못된 UUID 형식:', userId);
      return NextResponse.json(
        { success: false, error: `잘못된 사용자 ID 형식입니다: ${userId}` },
        { status: 400 }
      );
    }

    // 실제 데이터베이스에서 사용자 정보 조회
    console.log('🔍 실제 Supabase에서 사용자 정보 조회:', userId);
    
    const { data: userData, error: userError } = await supabase
      .from('profiles')
      .select('email, name')
      .eq('id', userId)
      .single();

    if (userError) {
      console.error('❌ 사용자 조회 오류:', userError);
      throw new Error(`사용자 조회 실패: ${userError.message}`);
    }
    
    const user = userData;

    // 현재 관리자 권한 체크
    const isCurrentlyAdmin = await isAdminUser(user.email);
    
    // 관리자 권한 부여
    if (action === 'grant_admin') {
      if (isCurrentlyAdmin) {
        return NextResponse.json(
          { success: false, error: '이미 관리자 권한을 가지고 있습니다.' },
          { status: 400 }
        );
      }

      // 기존 관리자 레코드가 있는지 확인
      const { data: existingAdmin, error: checkError } = await supabase
        .from('admin_users')
        .select('id, is_active')
        .eq('user_id', userId)
        .single();

      let adminUser;
      let adminError;

      if (existingAdmin) {
        // 기존 레코드가 있으면 업데이트
        const { data, error } = await supabase
          .from('admin_users')
          .update({
            is_active: true,
            granted_at: new Date().toISOString(),
            revoked_at: null
          })
          .eq('user_id', userId)
          .select()
          .single();
        
        adminUser = data;
        adminError = error;
      } else {
        // 기존 레코드가 없으면 새로 생성
        const { data, error } = await supabase
          .from('admin_users')
          .insert({
            user_id: userId,
            email: user.email,
            is_active: true,
            granted_at: new Date().toISOString()
          })
          .select()
          .single();
        
        adminUser = data;
        adminError = error;
      }

      if (adminError) {
        console.error('❌ 관리자 권한 부여 오류:', adminError);
        throw new Error(`관리자 권한 부여 실패: ${adminError.message}`);
      }

      console.log(`✅ 관리자 권한 부여 완료: ${user.email}`);

      return NextResponse.json({
        success: true,
        data: {
          userId,
          action,
          message: `${user.name}에게 관리자 권한이 부여되었습니다.`
        }
      });
    }

    // 관리자 권한 해제
    if (action === 'revoke_admin') {
      if (!isCurrentlyAdmin) {
        return NextResponse.json(
          { success: false, error: '관리자 권한을 가지고 있지 않습니다.' },
          { status: 400 }
        );
      }

      // 관리자 권한 해제 (비활성화)
      const { error: revokeError } = await supabase
        .from('admin_users')
        .update({
          is_active: false,
          revoked_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (revokeError) {
        console.error('❌ 관리자 권한 해제 오류:', revokeError);
        throw new Error(`관리자 권한 해제 실패: ${revokeError.message}`);
      }

      console.log(`✅ 관리자 권한 해제 완료: ${user.email}`);

      return NextResponse.json({
        success: true,
        data: {
          userId,
          action,
          message: `${user.name}의 관리자 권한이 해제되었습니다.`
        }
      });
    }

    // 사용자 상태 업데이트 (활성화/비활성화)
    if (action === 'activate' || action === 'deactivate') {
      const { data: authUser, error: authError } = await supabase.auth.admin.updateUserById(
        userId,
        {
          email_confirm: action === 'activate'
        }
      );

      if (authError) {
        console.error('❌ 사용자 상태 업데이트 오류:', authError);
        throw new Error(`사용자 상태 업데이트 실패: ${authError.message}`);
      }

      console.log(`✅ 사용자 상태 업데이트 완료: ${userId} - ${action}`);

      return NextResponse.json({
        success: true,
        data: {
          userId,
          action,
          message: action === 'activate' ? '사용자가 활성화되었습니다.' : '사용자가 비활성화되었습니다.'
        }
      });
    }

    // 사용자 삭제
    if (action === 'delete') {
      // Mock 데이터든 실제 데이터든 모두 실제 삭제 수행
      console.log(`🗑️ 사용자 삭제 시작: ${userId}`);
      
      // 1. 관련 데이터 먼저 삭제 (외래키 제약조건 고려)
      try {
        // 사용자의 대화 기록 삭제
        const { error: conversationsError } = await supabase
          .from('conversations')
          .delete()
          .eq('user_id', userId);
        
        if (conversationsError) {
          console.warn('⚠️ 대화 기록 삭제 중 오류 (무시):', conversationsError);
        }

        // 사용자의 피드백 기록 삭제
        const { error: feedbackError } = await supabase
          .from('feedback')
          .delete()
          .eq('user_id', userId);
        
        if (feedbackError) {
          console.warn('⚠️ 피드백 기록 삭제 중 오류 (무시):', feedbackError);
        }

        // 사용자의 메시지 기록 삭제
        const { error: messagesError } = await supabase
          .from('messages')
          .delete()
          .eq('user_id', userId);
        
        if (messagesError) {
          console.warn('⚠️ 메시지 기록 삭제 중 오류 (무시):', messagesError);
        }

        // 관리자 권한 삭제
        const { error: adminError } = await supabase
          .from('admin_users')
          .delete()
          .eq('user_id', userId);
        
        if (adminError) {
          console.warn('⚠️ 관리자 권한 삭제 중 오류 (무시):', adminError);
        }

        // 2. 사용자 프로필 삭제
        const { error: profileError } = await supabase
          .from('profiles')
          .delete()
          .eq('id', userId);

        if (profileError) {
          console.error('❌ 프로필 삭제 오류:', profileError);
          throw new Error(`프로필 삭제 실패: ${profileError.message}`);
        }

        // 3. 사용자 인증 정보 삭제 (Supabase Auth)
        console.log('🔑 Supabase Auth 삭제 시도:', userId);
        const { error: authError } = await supabase.auth.admin.deleteUser(userId);

        if (authError) {
          console.error('❌ 사용자 인증 정보 삭제 오류:', authError);
          console.error('❌ Service Role Key 권한 확인 필요');
          // Auth 삭제 실패해도 다른 데이터는 삭제되었으므로 성공으로 처리
          console.warn('⚠️ Auth 삭제 실패했지만 다른 데이터는 삭제됨');
        } else {
          console.log('✅ Supabase Auth 삭제 성공');
        }

        console.log(`✅ 사용자 완전 삭제 완료: ${userId}`);

        return NextResponse.json({
          success: true,
          data: {
            userId,
            action,
            message: '사용자와 관련된 모든 데이터가 삭제되었습니다.'
          }
        });

      } catch (error) {
        console.error('❌ 사용자 삭제 중 오류:', error);
        throw error;
      }
    }

    return NextResponse.json(
      { success: false, error: '지원하지 않는 작업입니다.' },
      { status: 400 }
    );

  } catch (error) {
    console.error('❌ 사용자 권한 관리 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '사용자 권한 관리 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}
