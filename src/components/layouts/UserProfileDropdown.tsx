"use client";

import { useState, useRef, useEffect } from "react";
import { User, Settings, Lock, Trash2, ChevronDown, Shield } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { PasswordChangeModal } from "./PasswordChangeModal";
import { DeleteAccountModal } from "./DeleteAccountModal";

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

  // 관리자 권한 체크
  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!user?.email) {
        setIsAdmin(false);
        setAdminLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/admin/users/check-admin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email: user.email })
        });

        const data = await response.json();
        setIsAdmin(data.success && data.isAdmin);
      } catch (error) {
        console.error('관리자 권한 확인 오류:', error);
        setIsAdmin(false);
      } finally {
        setAdminLoading(false);
      }
    };

    checkAdminStatus();
  }, [user?.email]);

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
            // 이용 권한 요청 모달을 열기 위한 이벤트 발생
            window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { mode: 'signup' } }));
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-all duration-200 hover:shadow-lg"
        >
          이용 권한 요청
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
          <span className="text-sm font-medium">{user?.user_metadata?.name || user?.email || '사용자'}</span>
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
                  <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-white font-medium">{user?.user_metadata?.name || '사용자'}</p>
                    <p className="text-gray-400 text-sm">{user?.email || '이메일 없음'}</p>
                  </div>
                </div>
              </div>

              {/* Menu Items */}
              <div className="py-2">
                {/* 관리자 메뉴 */}
                {isAdmin && (
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

                <button
                  onClick={() => {
                    setShowPasswordModal(true);
                    setIsOpen(false);
                  }}
                  className="w-full flex items-center space-x-3 px-4 py-3 text-gray-300 hover:text-white hover:bg-gray-800 transition-colors duration-200"
                >
                  <Lock className="w-4 h-4" />
                  <span>비밀번호 변경</span>
                </button>

                <button
                  onClick={() => {
                    setShowDeleteModal(true);
                    setIsOpen(false);
                  }}
                  className="w-full flex items-center space-x-3 px-4 py-3 text-red-400 hover:text-red-300 hover:bg-gray-800 transition-colors duration-200"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>회원탈퇴</span>
                </button>

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
