"use client";

import { motion } from "framer-motion";
import MainLayout from "@/components/layouts/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  MessageSquare, 
  History, 
  Send, 
  Search, 
  Info, 
  Sparkles,
  Wand2,
  Check,
  ArrowRight
} from "lucide-react";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDashboardStats, useChatStats, useSystemStatus, useLatestUpdate } from "@/hooks/useDashboardStats";
import { useAuth } from "@/hooks/useAuth";
import { siMeta, siNaver, siKakao, siGoogle, siX } from "simple-icons/icons";

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
  Meta: "#1877F2", // Facebook Blue
  Naver: "#03C75A", // Naver Green
  Kakao: "#FEE500", // Kakao Yellow
  Google: "#4285F4", // Google Blue
  "X(Twitter)": "#000000", // X Black (다크 배경에서는 흰색으로 조정)
};

// 벤더 배너 컴포넌트
function VendorBanner() {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <motion.div
      className="overflow-hidden relative max-w-4xl mx-auto"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.8 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="relative w-full h-32 flex items-center">
        <motion.div
          className="flex items-center gap-6 whitespace-nowrap"
          animate={isHovered ? {} : {
            x: [0, -1000], // 벤더 카드 너비만큼 이동
          }}
          transition={{
            x: {
              repeat: Infinity,
              repeatType: "loop",
              duration: 25,
              ease: "linear",
            },
          }}
        >
          {/* 무한 루프를 위한 벤더 복제 */}
          {[...VENDORS, ...VENDORS, ...VENDORS].map((v, index) => {
            const icon = vendorIcons[v];
            const brandColor = vendorColors[v];
            const iconColor = v === "X(Twitter)" ? "#FFFFFF" : brandColor;
            
            return (
              <motion.div
                key={`${v}-${index}`}
                className="flex items-center gap-3 min-w-[120px]"
                whileHover={{ scale: 1.1, y: -5 }}
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg transition-all backdrop-blur-sm border border-white/20 flex-shrink-0 bg-white/10">
                  {icon && (
                    <svg
                      role="img"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-7 h-7"
                      fill={iconColor}
                    >
                      <path d={icon.path} />
                    </svg>
                  )}
                </div>
                <span className="text-white font-semibold font-nanum text-sm text-center whitespace-nowrap">{v}</span>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </motion.div>
  );
}

export default function TestMultiVendorsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [chatInput, setChatInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // 버전5: 자동 벤더 감지 상태
  const [detectedVendors, setDetectedVendors] = useState<string[]>([]);
  const [manualOverride, setManualOverride] = useState(false);
  const [manualSelected, setManualSelected] = useState<string[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);

  const { data: dashboardStats, isLoading: dashboardLoading } = useDashboardStats();
  const { data: chatStats, isLoading: chatLoading } = useChatStats();
  const { data: systemStatus, isLoading: statusLoading } = useSystemStatus();
  const { data: latestUpdate, isLoading: updateLoading, error: updateError } = useLatestUpdate();

  // 벤더 자동 감지 함수
  const handleQueryChange = async (value: string) => {
    setChatInput(value);
    if (!manualOverride && value.trim().length > 3) {
      setIsDetecting(true);
      try {
        const res = await fetch('/api/detect-vendors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: value }),
        });
        const data = await res.json();
        if (data.vendors && Array.isArray(data.vendors)) {
          setDetectedVendors(data.vendors);
        }
      } catch (e) {
        console.error('벤더 감지 오류:', e);
      } finally {
        setIsDetecting(false);
      }
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    
    try {
      setIsLoading(true);
      
      if (!user) {
        console.warn('로그인이 필요합니다.');
        setIsLoading(false);
        return;
      }

      const vendorsToUse = manualOverride ? manualSelected : detectedVendors;
      const vendorsParam = vendorsToUse.length > 0 
        ? `&vendors=${vendorsToUse.map(v => encodeURIComponent(v)).join(',')}`
        : '';
      
      const encodedQuestion = encodeURIComponent(chatInput.trim());
      router.push(`/chat?q=${encodedQuestion}${vendorsParam}`);
      
    } catch (error) {
      console.error('Chat submit error:', error);
      setIsLoading(false);
    }
  };

  const focusInput = () => {
    try {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    } catch (error) {
      console.error('Focus input error:', error);
    }
  };

  return (
    <MainLayout>
      {/* Hero Section - 로고 배너 애니메이션 적용 */}
      <motion.div 
        className="relative w-full min-h-[50vh] flex items-center justify-center overflow-hidden pt-16"
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
            className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-8 leading-tight font-nanum"
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
            className="text-xl text-gray-300 mb-10 max-w-4xl mx-auto leading-relaxed font-nanum"
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

      {/* Chat Input Section with Auto-Detection (Version 5) */}
      <motion.div 
        className="relative w-full py-4 overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 1.0 }}
      >
        <div className="max-w-4xl mx-auto px-6">
          <motion.div 
            className="w-full"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 1.2 }}
          >
            {/* 자동 감지된 벤더 표시 */}
            {detectedVendors.length > 0 && !manualOverride && !isDetecting && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 relative"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 via-indigo-500/20 to-purple-500/20 rounded-2xl blur-xl"></div>
                <div className="relative card-enhanced rounded-2xl p-5 border border-blue-400/30 bg-blue-500/10 backdrop-blur-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center">
                        <Wand2 className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <span className="text-blue-200 font-semibold font-nanum text-base">
                          AI가 자동으로 감지한 플랫폼
                        </span>
                        <p className="text-blue-300/70 text-xs font-nanum mt-1">
                          질문 내용을 분석하여 관련 광고 플랫폼을 자동 선택했습니다
                        </p>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => setManualOverride(true)}
                      className="text-blue-200 hover:text-white hover:bg-blue-500/20 border-blue-400/30"
                    >
                      수정
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {detectedVendors.map((v) => (
                      <Badge 
                        key={v} 
                        className="bg-gradient-to-r from-blue-600/80 to-indigo-600/80 border-blue-400/50 text-white px-4 py-1.5 font-nanum shadow-lg"
                      >
                        <Check className="w-3 h-3 mr-1.5" />
                        {v}
                      </Badge>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* 감지 중 표시 */}
            {isDetecting && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mb-6 card-enhanced rounded-2xl p-4 border border-gray-400/20 bg-gray-500/10 backdrop-blur-sm"
              >
                <div className="flex items-center justify-center gap-3">
                  <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-gray-300 font-nanum">플랫폼 감지 중...</span>
                </div>
              </motion.div>
            )}

            {/* 수동 벤더 선택 모드 */}
            {manualOverride && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 card-enhanced rounded-2xl p-5 border border-indigo-400/30 bg-indigo-500/10 backdrop-blur-sm"
              >
                <div className="flex items-center justify-between mb-4">
                  <label className="text-indigo-200 font-semibold font-nanum text-base">
                    플랫폼 직접 선택
                  </label>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      setManualOverride(false);
                      setManualSelected([]);
                      if (chatInput.trim().length > 3) {
                        handleQueryChange(chatInput);
                      }
                    }}
                    className="text-indigo-200 hover:text-white hover:bg-indigo-500/20 border-indigo-400/30"
                  >
                    자동 감지로 전환
                  </Button>
                </div>
                <div className="flex flex-wrap gap-3">
                  {VENDORS.map((v) => (
                    <button
                      key={v}
                      onClick={() => {
                        setManualSelected(prev => 
                          prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
                        );
                      }}
                      className={`px-5 py-2.5 rounded-full border-2 transition-all duration-300 flex items-center gap-2 font-nanum ${
                        manualSelected.includes(v)
                          ? "bg-gradient-to-r from-indigo-600 to-purple-600 border-indigo-400 text-white shadow-lg scale-105"
                          : "bg-white/5 border-gray-400/30 text-gray-300 hover:border-indigo-400/50 hover:bg-indigo-500/10"
                      }`}
                    >
                      {manualSelected.includes(v) && <Check className="w-4 h-4" />}
                      {v}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            <form onSubmit={handleChatSubmit} className="w-full">
              <div className="relative w-full">
                <div className="card-premium rounded-3xl shadow-2xl overflow-hidden group">
                  <div className="p-6">
                    <div className="flex items-center space-x-4">
                      <div className="flex-1 relative">
                        <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-300 w-5 h-5 icon-enhanced group-hover:text-blue-400 transition-colors duration-300" />
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <input
                                ref={inputRef}
                                type="text"
                                placeholder="예) 인스타그램 광고 집행 정책 / 네이버 검색광고 요건 / 카카오 비즈보드 소재 제한..."
                                value={chatInput}
                                onChange={(e) => handleQueryChange(e.target.value)}
                                className="pl-12 pr-4 py-4 text-base border-0 bg-transparent text-white focus:ring-0 focus:outline-none rounded-none w-full font-nanum placeholder-white"
                                style={{
                                  color: '#ffffff',
                                }}
                              />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>질문을 입력하면 AI가 관련 플랫폼을 자동으로 감지합니다</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="submit"
                              disabled={isLoading || !chatInput.trim()}
                              className="w-14 h-14 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-110 hover:-translate-y-1 flex items-center justify-center p-0 min-w-0 flex-shrink-0"
                            >
                              {isLoading ? (
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              ) : (
                                <Send className="w-5 h-5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>질문하기</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 text-center">
                  <p className="text-sm text-gray-400 font-nanum">
                    💡 AI가 질문 내용을 분석해 관련 광고 플랫폼을 자동으로 선택합니다. 필요시 직접 선택할 수도 있습니다.
                  </p>
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      </motion.div>

      {/* Latest Update Section - 메인 페이지 스타일 */}
      <div className="relative max-w-7xl mx-auto px-6 py-12">
        <motion.div 
          className="mb-12"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
        >
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 via-indigo-500/20 to-purple-500/20 rounded-2xl blur-xl animate-enhanced-pulse"></div>
            
            <div className="relative card-enhanced rounded-2xl p-6 shadow-2xl hover:shadow-blue-500/25 transition-all duration-300 hover:scale-[1.02] group">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-blue-400/20 via-indigo-400/20 to-purple-400/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              
              <div className="relative z-10">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-start space-x-4">
                    <div className="relative flex-shrink-0">
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg animate-enhanced-pulse">
                        <Info className="w-6 h-6 text-white" />
                      </div>
                      <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-pulse"></div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="text-xl font-bold font-nanum" style={{color: '#1d1f24'}}>최신 업데이트</h3>
                        <Badge className="bg-gradient-to-r from-blue-500/30 to-indigo-500/30 text-blue-200 border-blue-400/50 font-nanum shadow-lg text-xs">
                          멀티 벤더
                        </Badge>
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-right flex-shrink-0 ml-4">
                    <div className="text-sm font-semibold text-enhanced font-nanum">
                      {updateLoading ? "로딩 중..." : latestUpdate?.displayDate || "최근"}
                    </div>
                    <div className="text-xs text-muted-enhanced font-nanum">업데이트</div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  {updateLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-5 w-full" />
                      <Skeleton className="h-4 w-4/5" />
                    </div>
                  ) : updateError ? (
                    <div className="bg-blue-500/10 rounded-lg p-4 border border-blue-400/20">
                      <p className="text-blue-100 leading-relaxed font-nanum text-base">
                        여러 플랫폼의 광고 정책 문서가 최신 상태로 유지되고 있습니다.
                      </p>
                    </div>
                  ) : (
                    <div className="bg-blue-500/10 rounded-lg p-4 border border-blue-400/20">
                      <p className="text-blue-100 leading-relaxed font-nanum text-base">
                        {latestUpdate?.message || "Meta, Naver, Kakao, Google, X 등 여러 플랫폼의 광고 정책 문서가 최신 상태로 동기화되어 있습니다."}
                      </p>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-blue-300">
                      <Sparkles className="w-4 h-4" />
                      <span className="text-sm font-nanum">
                        {latestUpdate?.hasNewFeatures ? "새로운 기능 포함" : "멀티 플랫폼 지원"}
                      </span>
                    </div>
                    <div className="text-xs text-blue-400/70 font-nanum">
                      실시간 동기화
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* CTA Section - 메인 페이지 스타일 */}
        <motion.div 
          className="text-center"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
        >
          <motion.div 
            className="card-premium p-12 overflow-hidden group"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            viewport={{ once: true }}
          >
            <div className="card-content-animated">
              <h2 className="text-3xl md:text-4xl font-bold mb-6 font-nanum group-hover:scale-105 transition-transform duration-300" style={{color: '#1d1f24'}}>
                하나의 질문으로 모든 플랫폼 정책을 확인하세요
              </h2>
              <p className="text-lg mb-8 max-w-3xl mx-auto font-nanum transition-colors duration-300" style={{color: '#1d1f24'}}>
                AI가 질문을 분석해 관련 광고 플랫폼을 자동 선택하고, 각 플랫폼별 정확한 답변을 제공합니다
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        onClick={focusInput}
                        className="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-2xl transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 hover:-translate-y-1 icon-enhanced"
                      >
                        <MessageSquare className="w-5 h-5 mr-2" />
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
                          className="px-8 py-4 border-2 border-white/30 text-white hover:bg-white/10 font-semibold rounded-2xl transition-all duration-300 hover:scale-105 hover:-translate-y-1 icon-enhanced"
                        >
                          <History className="w-5 h-5 mr-2" />
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
