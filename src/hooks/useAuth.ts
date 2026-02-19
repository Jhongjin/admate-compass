"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let timeoutId: NodeJS.Timeout;
    
    // Supabase 연결 상태 확인
    const isDummyClient = process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://dummy.supabase.co';
    
    if (isDummyClient) {
      console.warn('Supabase 환경변수가 설정되지 않았습니다. 더미 클라이언트를 사용합니다.');
      setUser(null);
      setLoading(false);
      return;
    }
    
    // 현재 세션 확인
    const getSession = async () => {
      try {
        console.log('세션 확인 시작...');
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          console.error('세션 확인 오류:', error);
        }
        console.log('세션 확인 완료:', session?.user?.email || '로그인되지 않음');
        setUser(session?.user ?? null);
        setLoading(false);
      } catch (error) {
        console.error('세션 확인 중 예외 발생:', error);
        setUser(null);
        setLoading(false);
      }
    };

    // 초기 세션 확인
    getSession();

    // 타임아웃 설정 (5초 후 강제로 로딩 해제)
    timeoutId = setTimeout(() => {
      console.log('로딩 타임아웃 - 강제로 로딩 해제');
      setLoading(false);
    }, 5000);

    // 인증 상태 변경 감지 (한 번만 처리)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        try {
          console.log('인증 상태 변경:', event, session?.user?.email);
          setUser(session?.user ?? null);
          // 로딩 상태는 초기화 후에는 변경하지 않음
        } catch (error) {
          console.error('인증 상태 변경 처리 중 오류:', error);
        }
      }
    );

    return () => {
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []); // 의존성 배열을 빈 배열로 변경

  const checkEmailExists = async (email: string): Promise<boolean> => {
    try {
      const supabase = createClient();
      // 데이터베이스 함수를 사용하여 이메일 중복 확인
      const { data, error } = await supabase
        .rpc('check_email_exists', { input_email: email });

      if (error) {
        console.warn('이메일 중복 확인 함수 호출 실패:', error);
        // 함수 호출 실패 시 false 반환하여 회원가입 진행
        // Supabase Auth 자체에서 중복 검사를 수행하므로 안전
        return false;
      }

      return !!data; // 함수가 true를 반환하면 중복
    } catch (error) {
      console.error('이메일 중복 확인 중 예외 발생:', error);
      return false; // 예외 발생 시 중복이 아닌 것으로 처리
    }
  };

  const signUp = async (email: string, password: string, name: string, team: string = '미디어본부') => {
    try {
      console.log('회원가입 시작:', { email, name, team });
      
      // 1단계: 이메일 중복 확인
      const emailExists = await checkEmailExists(email);
      if (emailExists) {
        return { 
          data: null, 
          error: { message: '이미 등록된 이메일입니다. 다른 이메일을 사용해주세요.' } 
        };
      }

      // 2단계: Supabase Auth로 회원가입 시도
      const supabase = createClient();
      const startTime = Date.now();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: name,
            team: team,
          }
        }
      });
      const authTime = Date.now() - startTime;
      console.log('Supabase Auth 회원가입 완료:', { authTime: `${authTime}ms`, error: !!error });

      if (error) {
        // Supabase Auth 에러 메시지 처리
        let errorMessage = '회원가입 중 오류가 발생했습니다.';
        
        if (error.message.includes('already registered') || 
            error.message.includes('already been registered') ||
            error.message.includes('User already registered')) {
          errorMessage = '이미 등록된 이메일입니다. 다른 이메일을 사용해주세요.';
        } else if (error.message.includes('Password should be at least')) {
          errorMessage = '비밀번호는 최소 6자 이상이어야 합니다.';
        } else if (error.message.includes('Invalid email')) {
          errorMessage = '올바른 이메일 형식을 입력해주세요.';
        } else if (error.message.includes('Signup is disabled')) {
          errorMessage = '현재 회원가입이 비활성화되어 있습니다. 관리자에게 문의해주세요.';
        } else {
          errorMessage = error.message;
        }
        
        return { data: null, error: { message: errorMessage } };
      }

      // 프로필 테이블 생성 제거 - Supabase Auth의 user_metadata만 사용
      console.log('회원가입 성공 - 프로필 테이블 생성 생략으로 속도 향상');

      return { data, error: null };
    } catch (error: any) {
      console.error('회원가입 오류:', error);
      
      // 에러 메시지 처리
      let errorMessage = '회원가입 중 오류가 발생했습니다.';
      
      if (error.message) {
        if (error.message.includes('already registered') || 
            error.message.includes('already been registered') ||
            error.message.includes('User already registered')) {
          errorMessage = '이미 등록된 이메일입니다. 다른 이메일을 사용해주세요.';
        } else if (error.message.includes('Password should be at least')) {
          errorMessage = '비밀번호는 최소 6자 이상이어야 합니다.';
        } else if (error.message.includes('Invalid email')) {
          errorMessage = '올바른 이메일 형식을 입력해주세요.';
        } else {
          errorMessage = error.message;
        }
      }
      
      return { data: null, error: { message: errorMessage } };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      // 이메일 유효성 검사 강화
      if (!email || !email.trim()) {
        return { data: null, error: { message: '이메일을 입력해주세요.' } };
      }
      
      if (!email.includes('@')) {
        return { data: null, error: { message: '올바른 이메일 형식을 입력해주세요.' } };
      }
      
      if (!password || !password.trim()) {
        return { data: null, error: { message: '비밀번호를 입력해주세요.' } };
      }

      const supabase = createClient();
      
      // Supabase 연결 상태 확인
      const isDummyClient = process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://dummy.supabase.co';
      if (isDummyClient) {
        return { 
          data: null, 
          error: { 
            message: 'Supabase 환경변수가 설정되지 않았습니다. 관리자에게 문의해주세요.' 
          } 
        };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        // 로그인 에러 메시지 처리
        let errorMessage = '로그인에 실패했습니다.';
        
        if (error.message.includes('Invalid login credentials')) {
          errorMessage = '이메일 또는 비밀번호가 올바르지 않습니다.';
        } else if (error.message.includes('Email not confirmed')) {
          errorMessage = '이메일 인증이 완료되지 않았습니다. 이메일을 확인해주세요.';
        } else if (error.message.includes('Too many requests')) {
          errorMessage = '너무 많은 로그인 시도가 있었습니다. 잠시 후 다시 시도해주세요.';
        } else if (error.message.includes('Failed to fetch')) {
          errorMessage = '네트워크 연결에 문제가 있습니다. 인터넷 연결을 확인해주세요.';
        } else if (error.message.includes('Could not establish connection')) {
          errorMessage = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.';
        } else {
          errorMessage = error.message;
        }
        
        return { data: null, error: { message: errorMessage } };
      }
      
      return { data, error: null };
    } catch (error: any) {
      console.error('로그인 오류:', error);
      
      // 네트워크 관련 오류 처리
      if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
        return { 
          data: null, 
          error: { 
            message: '네트워크 연결에 문제가 있습니다. 인터넷 연결을 확인해주세요.' 
          } 
        };
      }
      
      return { data: null, error: { message: '로그인 중 오류가 발생했습니다.' } };
    }
  };

  const signOut = async () => {
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('로그아웃 오류:', error);
        return { error: { message: '로그아웃 중 오류가 발생했습니다.' } };
      }
      return { error: null };
    } catch (error: any) {
      console.error('로그아웃 오류:', error);
      return { error: { message: '로그아웃 중 오류가 발생했습니다.' } };
    }
  };

  return {
    user,
    loading,
    signUp,
    signIn,
    signOut,
    checkEmailExists,
  };
}
