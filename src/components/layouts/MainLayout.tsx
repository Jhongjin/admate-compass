"use client";

import { useAuth } from "@/hooks/useAuth";
import { UserProfileDropdown } from "./UserProfileDropdown";
import { AuthModal } from "./AuthModal";
import { Toaster } from "@/components/ui/toaster";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";

interface MainLayoutProps {
  children: React.ReactNode;
  chatHeader?: React.ReactNode;
}

export default function MainLayout({ children, chatHeader }: MainLayoutProps) {
  const { user, loading, signOut } = useAuth();
  const [envError, setEnvError] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<"signin" | "signup">("signin");
  const [customBackground, setCustomBackground] = useState<string | null>(null);

  // 환경 변수 검증
  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn('Supabase 환경 변수가 설정되지 않았습니다. 더미 클라이언트를 사용합니다.');
    }
  }, []);

  // 커스텀 배경색 불러오기
  useEffect(() => {
    const savedBackground = localStorage.getItem('custom-background');
    if (savedBackground) {
      setCustomBackground(savedBackground);
      document.documentElement.style.setProperty('--main-background', savedBackground);
    } else {
      // 기본값으로 현재 테스트 페이지 설정 적용
      const defaultBackground = 'linear-gradient(180deg, #23262b 0%, #635488 50%, #9d6256 100%)';
      setCustomBackground(defaultBackground);
      document.documentElement.style.setProperty('--main-background', defaultBackground);
      localStorage.setItem('custom-background', defaultBackground);
    }
  }, []);

  // 인증 모달 이벤트 리스너
  useEffect(() => {
    const handleOpenAuthModal = (event: Event) => {
      try {
        // 이벤트 객체가 CustomEvent인지 확인
        if (event && typeof event === 'object' && 'detail' in event) {
          const customEvent = event as CustomEvent;
          if (customEvent.detail && typeof customEvent.detail === 'object' && 'mode' in customEvent.detail) {
            setAuthModalMode(customEvent.detail.mode);
            setAuthModalOpen(true);
          }
        }
      } catch (error) {
        console.error('인증 모달 이벤트 처리 중 오류:', error);
      }
    };

    window.addEventListener('openAuthModal', handleOpenAuthModal);
    
    return () => {
      window.removeEventListener('openAuthModal', handleOpenAuthModal);
    };
  }, []);

  // 로그아웃 핸들러
  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('로그아웃 오류:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">로딩 중...</div>
      </div>
    );
  }



  return (
             <div className="min-h-screen" style={{
               background: customBackground || 'var(--main-background, linear-gradient(180deg, #23262b 0%, #635488 50%, #9d6256 100%))'
             }}>
      {/* 헤더 - Lovable.dev 스타일, 스크롤 시에도 고정 */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/20 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 py-3">
            {/* AdMate 로고 */}
            <div className="flex items-center">
              <Link href="/" className="block">
                <motion.div 
                  className="cursor-pointer"
                  whileHover={{ 
                    scale: 1.05,
                    transition: { duration: 0.3 }
                  }}
                  whileTap={{ scale: 0.95 }}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <motion.div
                    whileHover={{
                      filter: "brightness(1.1) drop-shadow(0 4px 8px rgba(255, 107, 53, 0.3))",
                      transition: { duration: 0.2 }
                    }}
                  >
                    <Image
                      src="/admate-logo.png"
                      alt="AdMate - AI 기반 멀티 벤더 광고 정책 챗봇"
                      width={200}
                      height={96}
                      priority
                      className="h-24 w-auto"
                      style={{ height: '96px', width: 'auto' }}
                    />
                  </motion.div>
                </motion.div>
              </Link>
            </div>

            {/* 사용자 프로필 */}
            <UserProfileDropdown user={user} onSignOut={handleSignOut} />
          </div>
        </div>
      </header>

      {/* 채팅 헤더 */}
      {chatHeader && (
        <div className="fixed top-16 left-0 right-0 z-40">
          {chatHeader}
        </div>
      )}

      {/* 메인 콘텐츠 */}
      <main className="relative">
        {children}
      </main>

      {/* 인증 모달 */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        mode={authModalMode}
      />

      {/* Toast 알림 */}
      <Toaster />
    </div>
  );
}
