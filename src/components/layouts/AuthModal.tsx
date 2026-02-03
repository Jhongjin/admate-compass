"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Eye, EyeOff, Mail, Lock, User, Building2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

// 팀 목록 (숫자 -> ㄱㄴㄷ 순)
const TEAM_OPTIONS = [
  "1실",
  "2실", 
  "3실",
  "4실",
  "5실",
  "6실",
  "3본부",
  "미디어본부",
  "플랫폼본부",
  "경영본부"
];

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "signin" | "signup";
}

export function AuthModal({ isOpen, onClose, mode }: AuthModalProps) {
  const [isSignUp, setIsSignUp] = useState(mode === "signup");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    email: "@nasmedia.co.kr",
    password: "",
    confirmPassword: "",
    name: "",
    team: "미디어본부"
  });
  const [emailValidation, setEmailValidation] = useState({
    isValid: true,
    message: ""
  });

  const { signUp, signIn, checkEmailExists } = useAuth();
  const { toast } = useToast();
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 입력값 검증 강화
    if (!formData.email || !formData.email.trim()) {
      toast({
        title: "입력 오류",
        description: "이메일을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    // 이메일 형식 검증
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email.trim())) {
      toast({
        title: "입력 오류",
        description: "올바른 이메일 형식을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.password || !formData.password.trim()) {
      toast({
        title: "입력 오류",
        description: "비밀번호를 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    // 이메일 중복 검증 (회원가입 시에만)
    if (isSignUp && !emailValidation.isValid) {
      toast({
        title: "이메일 중복",
        description: emailValidation.message,
        variant: "destructive",
      });
      return;
    }

    if (isSignUp) {
      if (!formData.name) {
        toast({
          title: "입력 오류",
          description: "이름을 입력해주세요.",
          variant: "destructive",
        });
        return;
      }
      
      if (formData.password !== formData.confirmPassword) {
        toast({
          title: "비밀번호 불일치",
          description: "비밀번호가 일치하지 않습니다.",
          variant: "destructive",
        });
        return;
      }

      if (formData.password.length < 6) {
        toast({
          title: "비밀번호 길이 오류",
          description: "비밀번호는 최소 6자 이상이어야 합니다.",
          variant: "destructive",
        });
        return;
      }
    }

    setIsSubmitting(true);

    try {
      if (isSignUp) {
        const { data, error } = await signUp(formData.email, formData.password, formData.name, formData.team);
        
        if (error) {
          toast({
            title: "회원가입 실패",
            description: error.message,
            variant: "destructive",
          });
        } else {
          toast({
            title: "✅ 회원가입 성공",
            description: "회원가입이 완료되었습니다! 이메일을 확인하여 계정을 활성화해주세요.",
          });
          onClose();
          setFormData({ email: "@nasmedia.co.kr", password: "", confirmPassword: "", name: "", team: "미디어본부" });
        }
      } else {
        const { data, error } = await signIn(formData.email.trim(), formData.password);
        
        if (error) {
          toast({
            title: "로그인 실패",
            description: error.message,
            variant: "destructive",
          });
        } else {
          toast({
            title: "✅ 로그인 성공",
            description: "로그인이 완료되었습니다!",
          });
          onClose();
          setFormData({ email: "@nasmedia.co.kr", password: "", confirmPassword: "", name: "", team: "미디어본부" });
        }
      }
    } catch (error) {
      console.error('AuthModal handleSubmit error:', error);
      toast({
        title: "시스템 오류",
        description: "예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const validateEmail = useCallback(async (email: string) => {
    // 로그인 모드에서는 이메일 중복 검사를 하지 않음
    if (!isSignUp) {
      setEmailValidation({ isValid: true, message: "" });
      return;
    }
    
    if (!email || !email.includes('@nasmedia.co.kr')) {
      setEmailValidation({ isValid: true, message: "" });
      return;
    }

    try {
      const exists = await checkEmailExists(email);
      
      if (exists) {
        setEmailValidation({ 
          isValid: false, 
          message: "이미 등록된 이메일입니다." 
        });
      } else {
        setEmailValidation({ isValid: true, message: "" });
      }
    } catch (error) {
      console.error('이메일 검증 오류:', error);
      setEmailValidation({ isValid: true, message: "" });
    }
  }, [checkEmailExists, isSignUp]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // 이메일 필드 변경 시 디바운스된 실시간 검증 (회원가입 모드에서만)
    if (field === 'email' && isSignUp) {
      // 이전 타이머 취소
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
      
      // 500ms 후에 검증 실행
      validationTimeoutRef.current = setTimeout(() => {
        validateEmail(value);
      }, 500);
    } else if (field === 'email' && !isSignUp) {
      // 로그인 모드에서는 이메일 검증 상태 초기화
      setEmailValidation({ isValid: true, message: "" });
    }
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    setFormData({ email: "@nasmedia.co.kr", password: "", confirmPassword: "", name: "", team: "미디어본부" });
    setEmailValidation({ isValid: true, message: "" });
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
          className="relative w-full max-w-md bg-gray-900 rounded-2xl border border-white/20 shadow-2xl overflow-hidden"
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/10">
            <h2 className="text-2xl font-bold text-white">
              {isSignUp ? "회원가입" : "로그인"}
            </h2>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {isSignUp && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm font-medium text-gray-300">
                    이름
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input
                      id="name"
                      type="text"
                      placeholder="이름을 입력하세요"
                      value={formData.name}
                      onChange={(e) => handleInputChange("name", e.target.value)}
                      className="pl-10 bg-gray-800 border-gray-700 text-white placeholder-gray-400 focus:border-blue-500 focus:ring-blue-500"
                      required={isSignUp}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="team" className="text-sm font-medium text-gray-300">
                    소속
                  </Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 z-10" />
                    <Select
                      value={formData.team}
                      onValueChange={(value) => handleInputChange("team", value)}
                    >
                      <SelectTrigger className="pl-10 bg-gray-800 border-gray-700 text-white focus:border-blue-500 focus:ring-blue-500">
                        <SelectValue placeholder="소속을 선택하세요" />
                      </SelectTrigger>
                      <SelectContent className="bg-gray-800 border-gray-700">
                        {TEAM_OPTIONS.map((team) => (
                          <SelectItem 
                            key={team} 
                            value={team}
                            className="text-white hover:bg-gray-700 focus:bg-gray-700"
                          >
                            {team}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-gray-300">
                이메일
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  id="email"
                  type="text"
                  placeholder="사용자명"
                  value={formData.email.replace('@nasmedia.co.kr', '')}
                  onChange={(e) => handleInputChange("email", e.target.value + '@nasmedia.co.kr')}
                  className={`pl-10 pr-24 bg-gray-800 text-white placeholder-gray-400 focus:ring-blue-500 ${
                    isSignUp && !emailValidation.isValid 
                      ? 'border-red-500 focus:border-red-500' 
                      : 'border-gray-700 focus:border-blue-500'
                  }`}
                  required
                />
                <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 text-sm">
                  @nasmedia.co.kr
                </span>
              </div>
              {isSignUp && !emailValidation.isValid && emailValidation.message && (
                <p className="text-red-400 text-sm mt-1">{emailValidation.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-gray-300">
                비밀번호
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="비밀번호를 입력하세요"
                  value={formData.password}
                  onChange={(e) => handleInputChange("password", e.target.value)}
                  className="pl-10 pr-10 bg-gray-800 border-gray-700 text-white placeholder-gray-400 focus:border-blue-500 focus:ring-blue-500"
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

            {isSignUp && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-300">
                  비밀번호 확인
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="비밀번호를 다시 입력하세요"
                    value={formData.confirmPassword}
                    onChange={(e) => handleInputChange("confirmPassword", e.target.value)}
                    className="pl-10 bg-gray-800 border-gray-700 text-white placeholder-gray-400 focus:border-blue-500 focus:ring-blue-500"
                    required={isSignUp}
                  />
                </div>
              </div>
            )}

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-all duration-200 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <div className="flex items-center justify-center space-x-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>{isSignUp ? "회원가입 중..." : "로그인 중..."}</span>
                </div>
              ) : (
                <span>{isSignUp ? "회원가입" : "로그인"}</span>
              )}
            </Button>

            {/* Toggle Mode */}
            <div className="text-center pt-4 border-t border-white/10">
              <p className="text-gray-400 text-sm">
                {isSignUp ? "이미 계정이 있으신가요?" : "계정이 없으신가요?"}
                <button
                  type="button"
                  onClick={toggleMode}
                  className="ml-2 text-blue-400 hover:text-blue-300 font-medium transition-colors"
                >
                  {isSignUp ? "로그인" : "회원가입"}
                </button>
              </p>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
