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
  const { data, error } = await supabase
    .from('admin_users')
    .select('is_active')
    .eq('email', email)
    .eq('is_active', true)
    .single();
  
  if (error) {
    return false;
  }
  
  return !!data;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  team: string;
  is_admin: boolean;
  is_active: boolean;
  last_sign_in?: string;
  created_at: string;
  updated_at: string;
  conversation_count: number;
}

export async function GET(request: NextRequest) {
  try {
    console.log('🚀 사용자 목록 API 시작...');

    // URL 파라미터에서 검색어와 필터 가져오기
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const filter = searchParams.get('filter') || 'all';
    const sortBy = searchParams.get('sortBy') || 'created_at';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    // 실제 Supabase에서 사용자 데이터 조회
    console.log('📊 실제 사용자 데이터 조회 중...');
    
    // 1. 프로필 정보 조회
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, name, avatar_url, team, created_at, updated_at');

    if (profilesError) {
      console.error('❌ 프로필 조회 오류:', profilesError);
      throw new Error(`프로필 조회 실패: ${profilesError.message}`);
    }

    // 2. 관리자 권한 정보 조회
    const { data: adminUsers, error: adminError } = await supabase
      .from('admin_users')
      .select('user_id, is_active');

    if (adminError) {
      console.error('❌ 관리자 정보 조회 오류:', adminError);
      // 관리자 정보 조회 실패해도 계속 진행
    }

    // 3. 대화 수 조회
    const { data: conversationCounts, error: convError } = await supabase
      .from('conversations')
      .select('user_id')
      .not('user_id', 'is', null);

    if (convError) {
      console.error('❌ 대화 수 조회 오류:', convError);
      // 대화 수 조회 실패해도 계속 진행
    }

    // 4. 사용자 데이터 조합
    const users: User[] = (profiles || []).map((profile: any) => {
      const isAdmin = adminUsers?.some((admin: any) => 
        admin.user_id === profile.id && admin.is_active
      ) || false;
      
      const conversationCount = conversationCounts?.filter((conv: any) => 
        conv.user_id === profile.id
      ).length || 0;

      return {
        id: profile.id,
        email: profile.email,
        name: profile.name || '이름 없음',
        avatar_url: profile.avatar_url,
        team: profile.team || '미디어본부',
        is_admin: isAdmin,
        is_active: true, // 기본적으로 활성 상태로 설정
        last_sign_in: new Date().toISOString(), // 실제 last_sign_in은 auth.users에서 가져와야 함
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        conversation_count: conversationCount
      };
    });

    console.log(`📊 실제 사용자 데이터 조회 완료: ${users.length}명`);

    // 검색 필터 적용
    let filteredUsers = users;
    if (search) {
      filteredUsers = users.filter(user => 
        user.name.toLowerCase().includes(search.toLowerCase()) ||
        user.email.toLowerCase().includes(search.toLowerCase())
      );
    }

    // 필터 적용
    if (filter === 'admin') {
      filteredUsers = filteredUsers.filter(user => user.is_admin);
    } else if (filter === 'active') {
      filteredUsers = filteredUsers.filter(user => user.is_active);
    } else if (filter === 'inactive') {
      filteredUsers = filteredUsers.filter(user => !user.is_active);
    }

    // 정렬 적용
    filteredUsers.sort((a, b) => {
      let aValue, bValue;
      
      switch (sortBy) {
        case 'name':
          aValue = a.name;
          bValue = b.name;
          break;
        case 'email':
          aValue = a.email;
          bValue = b.email;
          break;
        case 'team':
          aValue = a.team || '';
          bValue = b.team || '';
          break;
        case 'last_sign_in':
          aValue = new Date(a.last_sign_in || 0).getTime();
          bValue = new Date(b.last_sign_in || 0).getTime();
          break;
        default:
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
      }

      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    // 페이지네이션 적용
    const totalCount = filteredUsers.length;
    const from = (page - 1) * limit;
    const to = from + limit;
    const paginatedUsers = filteredUsers.slice(from, to);

    console.log('📊 사용자 목록 처리 완료 (하드코딩):', {
      totalUsers: totalCount,
      currentPage: page,
      pageSize: limit,
      filteredUsers: paginatedUsers.length
    });

    return NextResponse.json({
      success: true,
      data: {
        users: paginatedUsers,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit)
        }
      }
    });

  } catch (error) {
    console.error('❌ 사용자 목록 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '사용자 목록 조회 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 사용자 추가 API 시작...');

    const body = await request.json();
    const { email, password, name, team = '미디어본부', isAdmin = false } = body;

    // 입력값 검증
    if (!email || !email.trim()) {
      return NextResponse.json(
        { success: false, error: '이메일을 입력해주세요.' },
        { status: 400 }
      );
    }

    if (!password || !password.trim()) {
      return NextResponse.json(
        { success: false, error: '비밀번호를 입력해주세요.' },
        { status: 400 }
      );
    }

    if (!name || !name.trim()) {
      return NextResponse.json(
        { success: false, error: '이름을 입력해주세요.' },
        { status: 400 }
      );
    }

    // 이메일 형식 및 도메인 검증
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: '올바른 이메일 형식을 입력해주세요.' },
        { status: 400 }
      );
    }

    // @nasmedia.co.kr 도메인만 허용
    if (!email.endsWith('@nasmedia.co.kr')) {
      return NextResponse.json(
        { success: false, error: '@nasmedia.co.kr 도메인만 사용 가능합니다.' },
        { status: 400 }
      );
    }

    // 비밀번호 길이 검증
    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: '비밀번호는 최소 6자 이상이어야 합니다.' },
        { status: 400 }
      );
    }

    // 1. 기존 사용자 확인 (Auth와 프로필 모두)
    console.log('🔍 기존 사용자 확인 중...');
    console.log(`📧 확인할 이메일: "${email.trim()}"`);
    
    // Auth 사용자 확인
    const { data: existingAuthUsers, error: authListError } = await supabase.auth.admin.listUsers();
    const existingAuthUser = existingAuthUsers?.users?.find((user: any) => user.email === email.trim());
    
    console.log(`🔍 Auth 사용자 검색 결과:`, {
      totalAuthUsers: existingAuthUsers?.users?.length || 0,
      foundAuthUser: existingAuthUser ? {
        id: existingAuthUser.id,
        email: existingAuthUser.email
      } : null
    });
    
    // 프로필 확인 (single() 대신 select() 사용하여 오류 방지)
    const { data: existingProfiles, error: profileCheckError } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email.trim());

    const existingProfile = existingProfiles && existingProfiles.length > 0 ? existingProfiles[0] : null;

    console.log(`🔍 프로필 검색 결과:`, {
      foundProfile: existingProfile ? {
        id: existingProfile.id
      } : null,
      profileError: profileCheckError?.message || null,
      totalProfiles: existingProfiles?.length || 0
    });

    // 이미 완전히 등록된 사용자인 경우 (Auth와 프로필 모두 존재)
    if (existingAuthUser && existingProfile) {
      console.log('❌ 이미 완전히 등록된 사용자 발견:', {
        authUser: existingAuthUser.email,
        profile: existingProfile.id
      });
      return NextResponse.json(
        { success: false, error: '이미 등록된 이메일입니다.' },
        { status: 400 }
      );
    }

    console.log('✅ 사용자 검증 통과 - 새 사용자 생성 가능');
    console.log('🔍 검증 결과 요약:', {
      hasAuthUser: !!existingAuthUser,
      hasProfile: !!existingProfile,
      authUserEmail: existingAuthUser?.email,
      profileId: existingProfile?.id
    });

    // Auth 사용자는 있지만 프로필이 없는 경우 (이전 실패한 시도)
    if (existingAuthUser && !existingProfile) {
      console.log('🧹 이전 실패한 Auth 사용자 정리 중...');
      try {
        await supabase.auth.admin.deleteUser(existingAuthUser.id);
        console.log('✅ 이전 Auth 사용자 삭제 완료');
      } catch (deleteError) {
        console.error('⚠️ 이전 Auth 사용자 삭제 실패:', deleteError);
        // 삭제 실패해도 계속 진행
      }
    }

    // 2. Supabase Auth에 사용자 생성
    console.log('👤 새 Auth 사용자 생성 중...');
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email.trim(),
      password: password,
      email_confirm: true, // 이메일 확인 자동 완료
      user_metadata: {
        name: name.trim()
      }
    });

    if (authError) {
      console.error('❌ 사용자 생성 오류:', authError);
      console.error('❌ Auth 오류 상세:', {
        message: authError.message,
        status: authError.status,
        name: authError.name
      });
      
      // 중복 이메일 오류 처리
      if (authError.message.includes('already registered') || authError.message.includes('duplicate') || authError.message.includes('User already registered')) {
        console.log('❌ Supabase Auth에서 이미 등록된 사용자로 판단');
        return NextResponse.json(
          { success: false, error: '이미 등록된 이메일입니다.' },
          { status: 400 }
        );
      }
      
      throw new Error(`사용자 생성 실패: ${authError.message}`);
    }

    const userId = authData.user.id;
    console.log(`✅ Auth 사용자 생성 완료: ${userId}`);

    // 3. 프로필 정보 생성
    console.log('📝 프로필 정보 생성 중...');
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        email: email.trim(),
        name: name.trim(),
        team: team,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (profileError) {
      console.error('❌ 프로필 생성 오류:', profileError);
      
      // 프로필 생성 실패 시 Auth 사용자도 삭제 (롤백)
      console.log('🔄 롤백: Auth 사용자 삭제 중...');
      try {
        await supabase.auth.admin.deleteUser(userId);
        console.log('✅ 롤백 완료: Auth 사용자 삭제됨');
      } catch (rollbackError) {
        console.error('❌ 롤백 실패:', rollbackError);
      }
      
      // 중복 키 오류인 경우 더 명확한 메시지
      if (profileError.message.includes('duplicate key') || profileError.message.includes('profiles_pkey')) {
        throw new Error('이미 등록된 사용자입니다. 잠시 후 다시 시도해주세요.');
      }
      
      throw new Error(`프로필 생성 실패: ${profileError.message}`);
    }

    console.log(`✅ 프로필 생성 완료: ${userId}`);

    // 4. 관리자 권한 부여 (필요한 경우)
    if (isAdmin) {
      console.log('👑 관리자 권한 부여 중...');
      const { error: adminError } = await supabase
        .from('admin_users')
        .insert({
          user_id: userId,
          email: email.trim(),
          is_active: true,
          granted_at: new Date().toISOString()
        });

      if (adminError) {
        console.error('❌ 관리자 권한 부여 오류:', adminError);
        // 관리자 권한 부여 실패해도 사용자 생성은 성공으로 처리
        console.warn('⚠️ 관리자 권한 부여 실패했지만 사용자는 생성됨');
      } else {
        console.log('✅ 관리자 권한 부여 완료');
      }
    }

    console.log(`✅ 사용자 생성 완료: ${email}`);

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: userId,
          email: email.trim(),
          name: name.trim(),
          is_admin: isAdmin,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          conversation_count: 0
        },
        message: `${name} 사용자가 성공적으로 생성되었습니다.`
      }
    });

  } catch (error) {
    console.error('❌ 사용자 추가 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '사용자 추가 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    console.log('🚀 사용자 정보 업데이트 API 시작...');

    const body = await request.json();
    const { userId, updates } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: '사용자 ID가 필요합니다.' },
        { status: 400 }
      );
    }

    // 1. 프로필 정보 업데이트
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .update({
        name: updates.name,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (profileError) {
      console.error('❌ 프로필 업데이트 오류:', profileError);
      throw new Error(`프로필 업데이트 실패: ${profileError.message}`);
    }

    console.log(`✅ 사용자 프로필 업데이트 완료: ${userId}`);

    return NextResponse.json({
      success: true,
      data: profile
    });

  } catch (error) {
    console.error('❌ 사용자 정보 업데이트 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '사용자 정보 업데이트 중 오류가 발생했습니다.'
      },
      { status: 500 }
    );
  }
}
