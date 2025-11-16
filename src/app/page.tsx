"use client";

import { motion } from "framer-motion";
import MainLayout from "@/components/layouts/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  MessageSquare, 
  History, 
  TrendingUp, 
  Users, 
  Clock, 
  ArrowRight,
  Sparkles,
  Shield,
  Globe,
  Send,
  Search,
  FileText,
  Brain,
  Info,
  AlertTriangle,
  Rocket,
  Bell,
  RefreshCw
} from "lucide-react";
import Link from "next/link";
import { useState, useRef, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDashboardStats, useChatStats } from "@/hooks/useDashboardStats";
import { useAuth } from "@/hooks/useAuth";
import { siMeta, siNaver, siKakao, siGoogle, siX } from "simple-icons/icons";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const VENDORS = ["Meta", "Naver", "Kakao", "Google", "X(Twitter)"] as const;

// 벤더별 아이콘 매핑
const vendorIcons: Record<string, typeof siMeta> = {
  Meta: siMeta,
  Naver: siNaver,
  Kakao: siKakao,
  Google: siGoogle,
  "X(Twitter)": siX,
};

// 벤더별 브랜드 컬러
const vendorColors: Record<string, string> = {
  Meta: "#1877F2",
  Naver: "#03C75A",
  Kakao: "#FEE500",
  Google: "#4285F4",
  "X(Twitter)": "#000000",
};

// 벤더 배너 컴포넌트
function VendorBanner() {
  const [isHovered, setIsHovered] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  
  // 접근성: prefers-reduced-motion 감지
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);
      
      const handleChange = (e: MediaQueryListEvent) => {
        setPrefersReducedMotion(e.matches);
      };
      
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);
  
  return (
    <motion.div
      className="overflow-hidden relative max-w-4xl mx-auto"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.8 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      aria-label="광고 플랫폼 벤더 목록"
    >
      <div className="relative w-full h-24 sm:h-32 flex items-center">
        <motion.div
          className="flex items-center gap-4 sm:gap-6 whitespace-nowrap"
          animate={isHovered || prefersReducedMotion ? {} : {
            x: [0, -1000],
          }}
          transition={prefersReducedMotion ? {} : {
            x: {
              repeat: Infinity,
              repeatType: "loop",
              duration: 25,
              ease: "linear",
            },
          }}
        >
          {[...VENDORS, ...VENDORS, ...VENDORS].map((v, index) => {
            const icon = vendorIcons[v];
            const brandColor = vendorColors[v];
            const iconColor = v === "X(Twitter)" ? "#FFFFFF" : brandColor;
            
            return (
              <motion.div
                key={`${v}-${index}`}
                className="flex items-center gap-2 sm:gap-3 min-w-[100px] sm:min-w-[120px]"
                whileHover={prefersReducedMotion ? {} : { scale: 1.1, y: -5 }}
                aria-label={`${v} 플랫폼`}
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shadow-lg transition-all backdrop-blur-sm border border-white/20 flex-shrink-0 bg-white/10">
                  {icon && (
                    <svg
                      role="img"
                      aria-label={`${v} 아이콘`}
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-6 h-6 sm:w-7 sm:h-7"
                      fill={iconColor}
                    >
                      <path d={icon.path} />
                    </svg>
                  )}
                </div>
                <span className="text-white font-semibold font-nanum text-xs sm:text-sm text-center whitespace-nowrap">{v}</span>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </motion.div>
  );
}

// 타입 정의
interface PerformanceMetric {
  metric: string;
  value: string;
  trend: string;
  status: 'good' | 'excellent' | 'warning' | 'error';
}

interface VendorUpdate {
  vendor: string;
  message: string;
  formattedDate?: string;
}

interface VendorUpdatesData {
  updatesWithDate: VendorUpdate[];
}

export default function HomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [chatInput, setChatInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 실제 데이터 가져오기
  const { data: dashboardStats, isLoading: dashboardLoading, error: dashboardError, refetch: refetchDashboard } = useDashboardStats();
  const { data: chatStats, isLoading: chatLoading, error: chatError, refetch: refetchChat } = useChatStats();
  
  // 벤더별 업데이트 정보 조회
  const { data: vendorUpdatesData, isLoading: vendorUpdatesLoading, error: vendorUpdatesError } = useQuery<VendorUpdatesData>({
    queryKey: ['vendor-updates'],
    queryFn: async () => {
      const response = await fetch('/api/vendor-updates');
      if (!response.ok) throw new Error('벤더 업데이트 정보 조회 실패');
      const data = await response.json();
      return data.data;
    },
    refetchInterval: 300000, // 5분마다 새로고침
    staleTime: 60000, // 1분간 캐시 유지
    retry: 1,
    retryDelay: 1000,
  });

  // 에러 로깅 (React Query v5에서는 onError가 제거됨)
  if (vendorUpdatesError) {
    console.error('벤더 업데이트 정보 조회 실패:', vendorUpdatesError);
  }

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    
    try {
      setIsLoading(true);
      
      // 로그인 체크 - 비로그인 사용자는 회원가입 권고 알럿
      if (!user) {
        toast({
          title: "로그인 필요",
          description: "질문을 하려면 먼저 회원가입 및 로그인이 필요합니다.",
          variant: "default",
          duration: 5000,
        });
        setIsLoading(false);
        return;
      }
      
      // 즉시 채팅 페이지로 이동 (지연 제거)
      const encodedQuestion = encodeURIComponent(chatInput.trim());
      router.push(`/chat?q=${encodedQuestion}`);
      
    } catch (error) {
      console.error('Chat submit error:', error);
      toast({
        title: "오류 발생",
        description: "질문 제출 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        variant: "destructive",
        duration: 5000,
      });
      setIsLoading(false);
    }
  };

  const focusInput = () => {
    inputRef.current?.focus();
  };


  const features = [
    {
      icon: "🧠",
      title: "AI 챗봇 대화",
      description: "자연어로 질문하면 AI가 관련 문서를 찾아 정확한 답변을 제공합니다.",
      badges: ["실시간 답변", "출처 표시", "한국어 지원"]
    },
    {
      icon: "📚",
      title: "히스토리 관리",
      description: "이전 질문과 답변을 언제든지 확인할 수 있습니다.",
      badges: ["검색 가능", "90일 보관"]
    },
    {
      icon: "🛡️",
      title: "보안 & 권한 관리",
      description: "사내 보안 정책에 맞춘 접근 제어와 데이터 보호를 제공합니다.",
      badges: ["SSO 연동", "권한 관리", "데이터 암호화"]
    },
    {
      icon: "🌐",
      title: "실시간 동기화",
      description: "최신 정책과 가이드라인이 실시간으로 반영되어 항상 최신 정보를 제공합니다.",
      badges: ["자동 업데이트", "실시간 반영", "버전 관리"]
    }
  ];

  // 실제 데이터 기반 통계 (useMemo로 최적화)
  const stats = useMemo(() => [
    {
      icon: "👥",
      value: dashboardStats?.weeklyStats?.users !== undefined && dashboardStats.weeklyStats.users > 0 
        ? `${dashboardStats.weeklyStats.users}+` 
        : "0+",
      label: "활성 사용자",
      description: "전사 직원들이 매일 사용"
    },
    {
      icon: "⏱️",
      value: chatStats?.averageResponseTime !== null && chatStats?.averageResponseTime !== undefined
        ? `${(chatStats.averageResponseTime / 1000).toFixed(1)}초`
        : "데이터 없음",
      label: "평균 응답 시간",
      description: "빠른 답변으로 업무 효율 향상"
    },
    {
      icon: "📈",
      value: chatStats?.userSatisfaction !== null && chatStats?.userSatisfaction !== undefined
        ? `${Math.round(chatStats.userSatisfaction * 100)}%`
        : "데이터 없음",
      label: "사용자 만족도",
      description: "정확하고 유용한 답변 제공"
    },
    {
      icon: "📄",
      value: dashboardStats?.totalDocuments !== undefined && dashboardStats.totalDocuments > 0
        ? `${dashboardStats.totalDocuments}+`
        : "0+",
      label: "문서 데이터베이스",
      description: "최신 정책과 가이드라인"
    }
  ], [dashboardStats, chatStats]);

  // 실제 성능 데이터 (useMemo로 최적화, 타입 안정성 개선)
  const performanceData = useMemo((): PerformanceMetric[] => {
    if (dashboardStats?.performanceMetrics && dashboardStats.performanceMetrics.length > 0) {
      return dashboardStats.performanceMetrics.map((item): PerformanceMetric => ({
        metric: item.metric || '',
        value: item.value || '데이터 없음',
        trend: item.trend || "+0%",
        status: (item.status || "good") as PerformanceMetric['status']
      }));
    }
    
    return [
      { 
        metric: "평균 응답 시간", 
        value: chatStats?.averageResponseTime !== null && chatStats?.averageResponseTime !== undefined
          ? `${(chatStats.averageResponseTime / 1000).toFixed(1)}초`
          : "데이터 없음", 
        trend: "+0%", 
        status: "good" as const 
      },
      { 
        metric: "일일 질문 수", 
        value: chatStats?.dailyQuestions !== null && chatStats?.dailyQuestions !== undefined
          ? `${chatStats.dailyQuestions.toLocaleString()}개`
          : "0개", 
        trend: "+0%", 
        status: "good" as const 
      },
      { 
        metric: "정확도", 
        value: chatStats?.accuracy !== null && chatStats?.accuracy !== undefined
          ? `${Math.round(chatStats.accuracy * 100)}%`
          : "데이터 없음", 
        trend: "+0%", 
        status: "excellent" as const 
      },
      { 
        metric: "사용자 만족도", 
        value: chatStats?.userSatisfaction !== null && chatStats?.userSatisfaction !== undefined
          ? `${chatStats.userSatisfaction.toFixed(1)}/5`
          : "데이터 없음", 
        trend: "+0", 
        status: "excellent" as const 
      },
      { 
        metric: "시스템 가동률", 
        value: dashboardStats?.systemStatus?.overall === 'healthy' ? "99.9%" : "데이터 없음", 
        trend: "+0.1%", 
        status: "excellent" as const 
      }
    ];
  }, [dashboardStats, chatStats]);


  return (
    <MainLayout>
      {/* Hero Section - 로고 배너 애니메이션 적용 */}
      <motion.div 
        className="relative w-full min-h-[40vh] sm:min-h-[50vh] flex items-center justify-center overflow-hidden pt-12 sm:pt-16"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <div className="max-w-5xl mx-auto px-6 text-center relative z-10 w-full">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <div className="inline-flex items-center px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white text-sm font-medium mb-8">
              <Sparkles className="w-4 h-4 mr-2" />
              AI 기반 멀티 벤더 광고 정책 챗봇
            </div>
          </motion.div>
          
          <motion.h1 
            className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-6 md:mb-8 leading-tight font-nanum px-2"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
          >
            멀티 플랫폼 광고 정책을
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mt-2">
              대화로 해결하세요
            </span>
          </motion.h1>
          
          <motion.p 
            className="text-base sm:text-lg md:text-xl text-gray-300 mb-6 md:mb-10 max-w-4xl mx-auto leading-relaxed font-nanum px-2"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
          >
            질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
          </motion.p>

          {/* 플랫폼 아이콘 배너 - 좌우에서 중앙으로 이동하며 페이드/블러 효과 */}
          <VendorBanner />
        </div>
      </motion.div>

      {/* Chat Input Section - Lovable.dev Style */}
      <motion.div 
        className="relative w-full py-4 overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 1.0 }}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <motion.div 
            className="w-full"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 1.2 }}
          >
            <form onSubmit={handleChatSubmit} className="w-full">
              <div className="relative w-full">
                {/* Main Chat Input Container - Lovable.dev Style */}
                <div className="card-premium rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden group">
                  {/* Input Field with Submit Button */}
                  <div className="p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
                      <div className="flex-1 relative">
                        <Search className="absolute left-3 sm:left-4 top-1/2 transform -translate-y-1/2 text-gray-300 w-4 h-4 sm:w-5 sm:h-5 icon-enhanced group-hover:text-blue-400 transition-colors duration-300" />
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Input
                                ref={inputRef}
                                type="text"
                                placeholder="예) 인스타그램 광고 집행 정책..."
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleChatSubmit(e as any);
                                  }
                                }}
                                className="pl-10 sm:pl-12 pr-4 py-3 sm:py-4 text-sm sm:text-base border-0 bg-transparent text-enhanced placeholder-gray-300 focus:ring-0 focus:outline-none rounded-none w-full group-hover:placeholder-blue-300 transition-colors duration-300"
                              />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>자연어로 질문하면 AI가 관련 문서를 찾아 답변해드립니다</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Button
                        type="submit"
                        disabled={isLoading || !chatInput.trim()}
                        className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-xl sm:rounded-2xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-105 hover:-translate-y-1 icon-enhanced text-sm sm:text-base"
                      >
                        {isLoading ? (
                          <div className="flex items-center space-x-2">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>처리중...</span>
                          </div>
                        ) : (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center space-x-2">
                                  <Send className="w-4 h-4" />
                                  <span>질문하기</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>질문을 제출하면 AI가 답변을 생성합니다</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
                
                {/* Help Text */}
                <div className="mt-3 sm:mt-4 flex items-center justify-center gap-2 px-2">
                  <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 text-yellow-400 flex-shrink-0" />
                  <p className="text-xs sm:text-sm text-gray-300 font-nanum text-center">
                    AI가 질문 내용을 분석해 관련 광고 플랫폼을 자동으로 선택합니다. 필요시 직접 선택할 수도 있습니다.
                  </p>
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      </motion.div>

      {/* Content Container - Lovable.dev Style */}
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        
        {/* Enhanced Latest Update Section */}
        <motion.div 
          className="mb-12"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
        >
          <div className="relative">
            {/* Background with blue-indigo gradient (matching other sections) */}
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 via-indigo-500/15 to-blue-500/10 rounded-3xl blur-2xl animate-enhanced-pulse"></div>
            <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 via-transparent to-indigo-600/5 rounded-3xl"></div>
            
            {/* Main container - matching card-premium style but with dark background */}
            <div className="relative bg-gradient-to-br from-gray-800/90 via-gray-800/80 to-gray-900/90 backdrop-blur-sm rounded-3xl p-6 sm:p-8 shadow-2xl border border-blue-500/20 hover:border-blue-400/30 transition-all duration-500 hover:shadow-blue-500/20 group overflow-hidden">
              {/* Animated gradient border on hover - blue-indigo */}
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-blue-500/0 via-indigo-500/0 to-blue-500/0 opacity-0 group-hover:opacity-100 group-hover:from-blue-500/10 group-hover:via-indigo-500/10 group-hover:to-blue-500/10 transition-all duration-500"></div>
              
              {/* Subtle inner glow - blue-indigo */}
              <div className="absolute inset-[1px] rounded-3xl bg-gradient-to-br from-blue-500/5 via-transparent to-indigo-500/5 pointer-events-none"></div>
              
              <div className="relative z-10">
                {/* Enhanced Header */}
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-start space-x-3 flex-1">
                    <div className="relative flex-shrink-0">
                      {/* Smaller, more refined icon */}
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30 relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent"></div>
                        <Bell className="w-5 h-5 text-white relative z-10 drop-shadow-lg" />
                      </div>
                      {/* Smaller notification badge */}
                      <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-gradient-to-br from-red-500 to-red-600 rounded-full animate-pulse shadow-lg shadow-red-500/50 border-2 border-gray-900"></div>
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center flex-wrap gap-2 mb-1">
                        <h3 className="text-xl font-bold font-nanum text-white">
                          최신 업데이트
                        </h3>
                        <Badge className="bg-gradient-to-r from-blue-500/30 via-indigo-500/30 to-blue-500/30 text-blue-100 border-blue-400/40 font-nanum shadow-lg text-xs px-2.5 py-0.5 backdrop-blur-sm">
                          멀티 벤더
                        </Badge>
                      </div>
                    </div>
                  </div>
                  
                  {/* Date indicator */}
                  <div className="text-right flex-shrink-0 ml-4 pt-0.5">
                    <div className="text-sm font-semibold text-white font-nanum mb-0.5">
                      {vendorUpdatesData?.updatesWithDate?.[0]?.formattedDate || new Date().toLocaleDateString('ko-KR')}
                    </div>
                    <div className="text-xs text-blue-300/70 font-nanum">업데이트</div>
                  </div>
                </div>
                
                {/* Enhanced Content Area */}
                <div className="space-y-4">
                  {vendorUpdatesLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-6 w-full bg-gray-700/50" />
                      <Skeleton className="h-4 w-4/5 bg-gray-700/50" />
                    </div>
                  ) : vendorUpdatesError ? (
                    <div className="bg-gradient-to-r from-red-500/10 to-orange-500/10 rounded-xl p-5 border border-red-400/20 backdrop-blur-sm">
                      <p className="text-red-100 leading-relaxed font-nanum text-base text-center">
                        업데이트 정보를 불러올 수 없습니다.
                      </p>
                    </div>
                  ) : vendorUpdatesData?.updatesWithDate && vendorUpdatesData.updatesWithDate.length > 0 ? (
                    <div className="relative h-16 overflow-hidden bg-gradient-to-br from-blue-500/10 via-indigo-500/10 to-blue-500/10 rounded-xl border border-blue-400/20 backdrop-blur-sm shadow-inner" aria-live="polite" aria-atomic="true">
                      {/* Gradient overlay for fade effect */}
                      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-blue-500/5 pointer-events-none z-10"></div>
                      <motion.div
                        className="flex flex-col"
                        animate={{
                          y: [0, -(vendorUpdatesData.updatesWithDate.length * 64)],
                        }}
                        transition={{
                          duration: vendorUpdatesData.updatesWithDate.length * 4,
                          repeat: Infinity,
                          ease: "linear",
                          repeatDelay: 0,
                        }}
                      >
                        {[...vendorUpdatesData.updatesWithDate, ...vendorUpdatesData.updatesWithDate].map((vendor: VendorUpdate, index: number) => {
                          const vendorIcon = vendorIcons[vendor.vendor];
                          const vendorColor = vendorColors[vendor.vendor];
                          return (
                          <div
                            key={`${vendor.vendor}-${index}`}
                              className="h-16 flex items-center justify-center px-6 min-h-[64px]"
                          >
                              <p className="text-white/90 leading-relaxed font-nanum text-base text-center flex items-center gap-2">
                                {vendorIcon && (
                                  <span 
                                    className="inline-block w-5 h-5 flex-shrink-0"
                                    style={{ color: vendorColor }}
                                    dangerouslySetInnerHTML={{ __html: vendorIcon.svg }}
                                  />
                                )}
                                <span>{vendor.message}</span>
                            </p>
                          </div>
                          );
                        })}
                      </motion.div>
                    </div>
                  ) : (
                    <div className="bg-gradient-to-r from-blue-500/10 to-indigo-500/10 rounded-xl p-5 border border-blue-400/20 backdrop-blur-sm">
                      <p className="text-blue-100 leading-relaxed font-nanum text-base text-center">
                        업데이트 정보를 불러오는 중입니다...
                      </p>
                    </div>
                  )}
                  
                  {/* Feature indicators */}
                  <div className="flex items-center justify-between pt-2 border-t border-blue-500/20">
                    <div className="flex items-center space-x-2 text-blue-300">
                      <Sparkles className="w-4 h-4 text-blue-400" />
                      <span className="text-sm font-nanum font-medium">멀티 플랫폼 지원</span>
                    </div>
                    <div className="flex items-center space-x-2 text-indigo-300">
                      <Clock className="w-4 h-4 text-indigo-400" />
                      <span className="text-xs font-nanum font-medium">실시간 동기화</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Performance Stats Table */}
        <motion.div 
          className="mb-12 sm:mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
        >
          <div className="text-center mb-6 sm:mb-8">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gradient mb-3 sm:mb-4 font-nanum px-2">
              실시간 성능 지표
            </h2>
            <p className="text-sm sm:text-base md:text-lg text-gray-300 max-w-3xl mx-auto font-nanum px-2">
              시스템 성능과 사용자 만족도를 실시간으로 확인하세요
            </p>
          </div>
          
                <Card className="card-premium group">
                  <CardContent className="p-4 sm:p-6 md:p-8 card-content-animated overflow-x-auto">
              {dashboardLoading || chatLoading ? (
                <div className="space-y-4">
                  {[...Array(5)].map((_, index) => (
                    <div key={index} className="flex items-center space-x-4">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-12" />
                      <Skeleton className="h-6 w-16" />
                    </div>
                  ))}
                </div>
              ) : dashboardError || chatError ? (
                <div className="text-center py-8">
                  <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                  <p className="text-red-400 font-nanum">
                    데이터를 불러오는 중 오류가 발생했습니다.
                  </p>
                  <Button 
                    onClick={() => {
                      refetchDashboard();
                      refetchChat();
                    }} 
                    variant="outline" 
                    className="mt-4 border-white/30 text-white hover:bg-white/10"
                  >
                    새로고침
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                  <Table className="min-w-[600px]">
                    <TableHeader>
                      <TableRow className="border-white/20">
                        <TableHead className="font-semibold text-sm sm:text-base text-card-foreground">지표</TableHead>
                        <TableHead className="font-semibold text-sm sm:text-base text-card-foreground">현재 값</TableHead>
                        <TableHead className="font-semibold text-sm sm:text-base hidden sm:table-cell text-card-foreground">변화율</TableHead>
                        <TableHead className="font-semibold text-sm sm:text-base text-card-foreground">상태</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {performanceData.map((item, index) => (
                        <TableRow key={index} className="border-white/10 hover:bg-white/5">
                          <TableCell className="font-medium text-sm sm:text-base text-card-foreground">{item.metric}</TableCell>
                          <TableCell className="font-semibold text-sm sm:text-base text-card-foreground">{item.value}</TableCell>
                          <TableCell className="text-green-300 text-sm sm:text-base hidden sm:table-cell">{item.trend}</TableCell>
                          <TableCell>
                            <Badge 
                              variant={item.status === 'excellent' ? 'default' : 'secondary'}
                              className={`text-xs sm:text-sm ${
                                item.status === 'excellent' 
                                  ? 'bg-green-500/20 text-green-400 border-green-400/30' 
                                  : 'bg-blue-500/20 text-blue-400 border-blue-400/30'
                              }`}
                            >
                              {item.status === 'excellent' ? '우수' : '양호'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>


        {/* Features Section - Simplified */}
        <motion.div 
          className="mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
        >
          <motion.div 
            className="text-center mb-6 sm:mb-8"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            viewport={{ once: true }}
          >
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-3 sm:mb-4 font-nanum px-2">
              강력한 기능으로 <span className="text-gradient-premium">업무를 혁신하세요</span>
            </h2>
            <p className="text-sm sm:text-base md:text-lg text-gray-300 max-w-3xl mx-auto font-nanum px-2">
              AdMate의 핵심 기능들이 여러분의 업무 효율성을 높여드립니다
            </p>
          </motion.div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {features.map((feature, index) => (
              <motion.div 
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: index * 0.1 }}
                viewport={{ once: true }}
              >
                <Card className="card-enhanced h-full group hover:-translate-y-2 hover:scale-[1.02] transition-all duration-500">
                  <CardContent className="p-8 h-full flex flex-col card-content-animated">
                    <div className="w-16 h-16 flex items-center justify-center mb-6 group-hover:scale-110 transition-all duration-300 icon-enhanced">
                      <div className="text-4xl">{feature.icon}</div>
                    </div>
                    <h3 className="text-xl font-bold mb-4 font-nanum transition-all duration-300 text-card-foreground">{feature.title}</h3>
                    <p className="leading-relaxed text-sm mb-6 flex-grow font-nanum transition-colors duration-300 text-card-foreground">{feature.description}</p>
                    <div className="flex flex-wrap gap-2">
                      {feature.badges.map((badge, badgeIndex) => (
                        <Badge 
                          key={badgeIndex} 
                          variant="secondary" 
                          className="badge-premium font-nanum shadow-sm hover:scale-105 transition-transform duration-200 stagger-1"
                        >
                          {badge}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
          
          {/* 통계 카드 섹션 */}
          <motion.div 
            className="mt-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <div className="text-center mb-6 sm:mb-8">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gradient mb-3 sm:mb-4 font-nanum px-2">
              실시간 통계
            </h2>
              <p className="text-sm sm:text-base md:text-lg text-gray-300 max-w-3xl mx-auto font-nanum px-2">
                시스템 사용 현황과 성능 지표를 확인하세요
              </p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {dashboardLoading || chatLoading ? (
                [...Array(4)].map((_, index) => (
                  <Card key={index} className="border-0 shadow-lg bg-white/5 backdrop-blur-sm border border-white/10">
                    <CardContent className="p-6 text-center">
                      <Skeleton className="w-12 h-12 mx-auto mb-4 rounded-full" />
                      <Skeleton className="h-6 w-16 mx-auto mb-2" />
                      <Skeleton className="h-4 w-24 mx-auto mb-2" />
                      <Skeleton className="h-3 w-32 mx-auto" />
                    </CardContent>
                  </Card>
                ))
              ) : (
                stats.map((stat, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: index * 0.1 }}
                    viewport={{ once: true }}
                  >
                    <Card className="card-enhanced group hover:-translate-y-3 hover:scale-[1.05] transition-all duration-500">
                      <CardContent className="p-6 sm:p-8 text-center card-content-animated">
                        <div className="w-12 h-12 sm:w-16 sm:h-16 flex items-center justify-center mx-auto mb-4 sm:mb-6 group-hover:scale-110 transition-all duration-300 icon-enhanced">
                          <div className="text-3xl sm:text-4xl">{stat.icon}</div>
                        </div>
                        <h3 className="text-2xl sm:text-3xl font-bold mb-2 sm:mb-3 font-nanum group-hover:scale-110 transition-transform duration-300 text-card-foreground">{stat.value}</h3>
                        <p className="font-semibold mb-2 sm:mb-3 text-sm sm:text-base font-nanum transition-colors duration-300 text-card-foreground">{stat.label}</p>
                        <p className="text-xs sm:text-sm font-nanum transition-colors duration-300 text-card-foreground">{stat.description}</p>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>



        {/* CTA Section - Simplified */}
        <motion.div 
          className="text-center"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
        >
          <motion.div 
            className="card-premium p-6 sm:p-8 md:p-12 overflow-hidden group"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            viewport={{ once: true }}
          >
            <div className="card-content-animated">
              <h2 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold mb-4 sm:mb-6 font-nanum group-hover:scale-105 transition-transform duration-300 px-2 text-card-foreground">
                하나의 질문으로 모든 플랫폼 정책을 확인하세요
              </h2>
              <p className="text-sm sm:text-base md:text-lg mb-6 sm:mb-8 max-w-3xl mx-auto font-nanum transition-colors duration-300 px-2 text-card-foreground">
                AI가 질문을 분석해 관련 광고 플랫폼을 자동 선택하고, <span className="whitespace-nowrap">각 플랫폼별 정확한 답변을 제공합니다</span>
              </p>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      onClick={focusInput}
                      className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-xl sm:rounded-2xl transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 hover:-translate-y-1 icon-enhanced text-sm sm:text-base"
                    >
                      <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                      질문하기
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>위의 입력창에 포커스를 맞춥니다</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link href="/history">
                      <Button 
                        variant="outline"
                        className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 border-2 border-white/30 text-white hover:bg-white/10 font-semibold rounded-xl sm:rounded-2xl transition-all duration-300 hover:scale-105 hover:-translate-y-1 icon-enhanced text-sm sm:text-base"
                      >
                        <History className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                        히스토리 보기
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>이전 질문과 답변을 확인하세요</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>



    </MainLayout>
  );
}