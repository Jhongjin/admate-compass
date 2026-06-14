"use client";

import { useAuth } from "@/hooks/useAuth";
import { AuthModal } from "./AuthModal";
import { Toaster } from "@/components/ui/toaster";
import { useEffect, useState } from "react";
import { CompassTopbar } from "./CompassTopbar";

interface MainLayoutProps {
  children: React.ReactNode;
  chatHeader?: React.ReactNode;
}

export default function MainLayout({ children, chatHeader }: MainLayoutProps) {
  const { loading } = useAuth();
  const [envError, setEnvError] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<"signin" | "signup">("signin");

  // 환경 변수 검증
  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn('Supabase 환경 변수가 설정되지 않았습니다. 더미 클라이언트를 사용합니다.');
    }
  }, []);

  // 인증 모달 이벤트 리스너
  useEffect(() => {
    const handleOpenAuthModal = (event: CustomEvent) => {
      setAuthModalMode(event.detail.mode);
      setAuthModalOpen(true);
    };

    window.addEventListener('openAuthModal', handleOpenAuthModal as EventListener);
    
    return () => {
      window.removeEventListener('openAuthModal', handleOpenAuthModal as EventListener);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4F5F0]">
        <div className="text-xl text-[#34423A]">로딩 중...</div>
      </div>
    );
  }



  return (
    <div className="min-h-screen bg-[#F4F5F0] text-[#111713]">
      <CompassTopbar title="Compass 근거 확인" subtitle="정책 질문과 확인한 출처를 함께 관리합니다." />

      {/* 메인 콘텐츠 */}
      <main className={chatHeader ? "relative flex h-[100dvh] flex-col overflow-hidden pt-16" : "relative pt-16"}>
        {chatHeader ? (
          <>
            <div className="relative z-40 shrink-0">
              {chatHeader}
            </div>
            <div className="min-h-0 flex-1">
              {children}
            </div>
          </>
        ) : (
          children
        )}
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
