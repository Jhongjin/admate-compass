"use client";

import { useState, useRef, useEffect } from "react";
import { User, Settings, Lock, Trash2, ChevronDown, Shield, UserCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { PasswordChangeModal } from "./PasswordChangeModal";
import { DeleteAccountModal } from "./DeleteAccountModal";
import { createClient } from "@/lib/supabase/client";

interface UserProfileDropdownProps {
  user: any;
  onSignOut: () => void;
}

export function UserProfileDropdown({ user, onSignOut }: UserProfileDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { signOut } = useAuth();

  // 관리자 권한 상태
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminLoading, setAdminLoading] = useState(true);
  
  // 프로필 데이터 상태
  const [profileData, setProfileData] = useState<{
    name: string;
    email: string;
    avatar_url: string;
  } | null>(null);

  // 관리자 권한 체크
  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!user?.email) {
        console.log('❌ 사용자 이메일이 없음');
        setIsAdmin(false);
        setAdminLoading(false);
        return;
      }

      console.log('🔍 관리자 권한 확인 시작:', user.email);

      try {
        const response = await fetch('/api/admin/users/check-admin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email: user.email })
        });

        const data = await response.json();
        console.log('📊 관리자 권한 확인 응답:', data);
        
        const isAdminResult = data.success && data.isAdmin;
        console.log('✅ 관리자 권한 결과:', isAdminResult);
        console.log('🔍 isAdmin 상태 업데이트:', { isAdminResult, dataSuccess: data.success, dataIsAdmin: data.isAdmin });
        
        // API 응답이 실패하더라도 특정 이메일은 관리자로 처리
        const hardcodedAdmins = ['woolela@nasmedia.co.kr'];
        const isHardcodedAdmin = hardcodedAdmins.includes(user.email);
        
        setIsAdmin(isAdminResult || isHardcodedAdmin);
      } catch (error) {
        console.error('❌ 관리자 권한 확인 오류:', error);
        // API 오류가 발생해도 하드코딩된 관리자는 관리자로 처리
        const hardcodedAdmins = ['woolela@nasmedia.co.kr'];
        const isHardcodedAdmin = hardcodedAdmins.includes(user.email);
        setIsAdmin(isHardcodedAdmin);
      } finally {
        setAdminLoading(false);
      }
    };

    checkAdminStatus();
  }, [user?.email]);

  // 프로필 데이터 로드
  useEffect(() => {
    const loadProfile = async () => {
      if (!user?.id) return;

      try {
        const supabase = createClient();
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('name, email, avatar_url')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('프로필 로드 오류:', error);
          // 에러가 있어도 기본값 설정
          setProfileData({
            name: user?.user_metadata?.name || user?.email || '사용자',
            email: user?.email || '',
            avatar_url: ''
          });
          return;
        }

        setProfileData({
          name: profile?.name || user?.user_metadata?.name || user?.email || '사용자',
          email: profile?.email || user?.email || '',
          avatar_url: profile?.avatar_url || ''
        });
      } catch (error) {
        console.error('프로필 로드 오류:', error);
        setProfileData({
          name: user?.user_metadata?.name || user?.email || '사용자',
          email: user?.email || '',
          avatar_url: ''
        });
      }
    };

    loadProfile();
  }, [user?.id]);

  // 프로필 업데이트 이벤트 리스너
  useEffect(() => {
    const handleProfileUpdate = () => {
      // 프로필이 업데이트되면 다시 로드
      if (user?.id) {
        const loadProfile = async () => {
          try {
            const supabase = createClient();
            const { data: profile, error } = await supabase
              .from('profiles')
              .select('name, email, avatar_url')
              .eq('id', user.id)
              .single();

            if (!error && profile) {
              setProfileData({
                name: profile?.name || user?.user_metadata?.name || user?.email || '사용자',
                email: profile?.email || user?.email || '',
                avatar_url: profile?.avatar_url || ''
              });
            }
          } catch (error) {
            console.error('프로필 새로고침 오류:', error);
          }
        };
        loadProfile();
      }
    };

    window.addEventListener('profileUpdated', handleProfileUpdate);
    return () => window.removeEventListener('profileUpdated', handleProfileUpdate);
  }, [user?.id]);

  // 모든 hooks를 조건부 return 이전에 정의
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    try {
      const { error } = await signOut();
      if (error) {
        console.error('로그아웃 오류:', error);
        alert('로그아웃 중 오류가 발생했습니다: ' + (error as any)?.message || '알 수 없는 오류');
        return;
      }
      onSignOut();
      setIsOpen(false);
    } catch (error) {
      console.error('로그아웃 오류:', error);
      alert('로그아웃 중 오류가 발생했습니다.');
    }
  };

  // user가 null일 때 로그인 버튼 표시
  if (!user) {
    return (
      <div className="flex items-center space-x-4">
        <button
          onClick={() => {
            // 로그인 모달을 열기 위한 이벤트 발생
            window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode: 'signin' } }));
          }}
          className="text-sm font-medium text-gray-300 hover:text-blue-400 transition-colors duration-200"
        >
          로그인
        </button>
        <button
          onClick={() => {
            // 회원가입 모달을 열기 위한 이벤트 발생
            window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode: 'signup' } }));
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-all duration-200 hover:shadow-lg"
        >
          회원가입
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center space-x-2 text-gray-300 hover:text-white transition-colors duration-200 rounded-lg hover:bg-white/5 p-2"
        >
          <User className="w-4 h-4" />
          <span className="text-sm font-medium">{profileData?.name || user?.user_metadata?.name || user?.email || '사용자'}</span>
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              className="absolute right-0 top-full mt-2 w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50"
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              {/* User Info */}
              <div className="p-4 border-b border-gray-700">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center overflow-hidden">
                    {profileData?.avatar_url ? (
                      <img 
                        src={profileData.avatar_url} 
                        alt="프로필 사진" 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <div>
                    <p className="text-white font-medium">{profileData?.name || user?.user_metadata?.name || '사용자'}</p>
                    <p className="text-gray-400 text-sm">{profileData?.email || user?.email || '이메일 없음'}</p>
                  </div>
                </div>
              </div>

              {/* Menu Items */}
              <div className="py-2">
                {/* 관리자 메뉴 - 관리자만 표시 */}
                {adminLoading ? (
                  <div className="w-full flex items-center space-x-3 px-4 py-3 text-gray-400">
                    <Shield className="w-4 h-4" />
                    <span>권한 확인 중...</span>
                  </div>
                ) : (() => {
                  console.log('🔍 관리자 메뉴 렌더링 조건:', { adminLoading, isAdmin, userEmail: user?.email });
                  return isAdmin;
                })() && (
                  <>
                    <a
                      href="/admin"
                      className="w-full flex items-center space-x-3 px-4 py-3 text-blue-400 hover:text-blue-300 hover:bg-gray-800 transition-colors duration-200"
                    >
                      <Shield className="w-4 h-4" />
                      <span>관리자 페이지</span>
                    </a>
                    
                    {/* 구분선 */}
                    <div className="border-t border-gray-700 my-2"></div>
                  </>
                )}

                <a
                  href="/mypage"
                  className="w-full flex items-center space-x-3 px-4 py-3 text-gray-300 hover:text-white hover:bg-gray-800 transition-colors duration-200"
                >
                  <UserCircle className="w-4 h-4" />
                  <span>프로필 변경</span>
                </a>

                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center space-x-3 px-4 py-3 text-gray-300 hover:text-white hover:bg-gray-800 transition-colors duration-200"
                >
                  <Settings className="w-4 h-4" />
                  <span>로그아웃</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Password Change Modal */}
      <PasswordChangeModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        user={user}
      />

      {/* Delete Account Modal */}
      <DeleteAccountModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        user={user}
        onSignOut={onSignOut}
      />
    </>
  );
}
