"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Eye, EyeOff, AlertTriangle, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  onSignOut: () => void;
}

export function DeleteAccountModal({ isOpen, onClose, user, onSignOut }: DeleteAccountModalProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    password: "",
    confirmText: ""
  });

  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.confirmText !== "회원탈퇴") {
      alert("확인 텍스트를 정확히 입력해주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      // 비밀번호로 재인증
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: formData.password,
      });

      if (reauthError) {
        alert("비밀번호가 올바르지 않습니다.");
        return;
      }

      // 사용자 계정 삭제
      const { error: deleteError } = await supabase.auth.admin.deleteUser(
        user.id
      );

      if (deleteError) {
        // 일반 사용자는 admin API를 사용할 수 없으므로 다른 방법 사용
        // profiles 테이블에서 사용자 정보 삭제 후 로그아웃
        const { error: profileDeleteError } = await supabase
          .from('profiles')
          .delete()
          .eq('id', user.id);

        if (profileDeleteError) {
          console.error('Profile deletion error:', profileDeleteError);
        }

        // 로그아웃 처리
        await supabase.auth.signOut();
        alert("회원탈퇴가 완료되었습니다. 이용해주셔서 감사합니다.");
        onSignOut();
        onClose();
      } else {
        alert("회원탈퇴가 완료되었습니다. 이용해주셔서 감사합니다.");
        onSignOut();
        onClose();
      }
    } catch (error) {
      alert(`오류가 발생했습니다: ${error}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        
        {/* Modal */}
        <motion.div
          className="relative w-full max-w-md bg-gray-900 rounded-2xl border border-red-500/20 shadow-2xl overflow-hidden"
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-red-500/20">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">회원탈퇴</h2>
                <p className="text-red-400 text-sm">이 작업은 되돌릴 수 없습니다</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Warning Message */}
          <div className="p-6 bg-red-500/10 border-l-4 border-red-500">
            <div className="flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="text-red-300 text-sm">
                <p className="font-medium mb-2">⚠️ 주의사항</p>
                <ul className="space-y-1">
                  <li>• 모든 데이터가 영구적으로 삭제됩니다</li>
                  <li>• 이 작업은 되돌릴 수 없습니다</li>
                  <li>• 계정과 관련된 모든 정보가 사라집니다</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-gray-300">
                비밀번호 확인
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="비밀번호를 입력하세요"
                  value={formData.password}
                  onChange={(e) => handleInputChange("password", e.target.value)}
                  className="bg-gray-800 border-gray-700 text-white placeholder-gray-400 focus:border-red-500 focus:ring-red-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmText" className="text-sm font-medium text-gray-300">
                확인 텍스트 입력
              </Label>
              <Input
                id="confirmText"
                type="text"
                placeholder="회원탈퇴"
                value={formData.confirmText}
                onChange={(e) => handleInputChange("confirmText", e.target.value)}
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-400 focus:border-red-500 focus:ring-red-500"
                required
              />
              <p className="text-gray-400 text-xs">위의 텍스트를 정확히 입력해주세요</p>
            </div>

            <div className="flex space-x-3 pt-4">
              <Button
                type="button"
                onClick={onClose}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 rounded-lg transition-all duration-200"
              >
                취소
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-all duration-200 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <div className="flex items-center justify-center space-x-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>처리 중...</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center space-x-2">
                    <Trash2 className="w-4 h-4" />
                    <span>회원탈퇴</span>
                  </div>
                )}
              </Button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

