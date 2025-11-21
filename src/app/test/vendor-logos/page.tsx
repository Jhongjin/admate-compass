"use client";

import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { siMeta, siNaver, siKakao, siGoogle, siX } from "simple-icons/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import MainLayout from "@/components/layouts/MainLayout";

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

// 벤더별 배경 그라데이션
const vendorGradients: Record<string, string> = {
  Meta: "from-blue-500 to-blue-600",
  Naver: "from-green-400 to-green-600",
  Kakao: "from-yellow-400 to-yellow-500",
  Google: "from-blue-500 via-red-500 to-yellow-500",
  "X(Twitter)": "from-gray-900 to-black",
};

// 스타일 1: 현재 스타일 (참고용)
function Style1_Current() {
  const [isHovered, setIsHovered] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);
      const handleChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);
  
  return (
    <motion.div
      className="overflow-hidden relative max-w-4xl mx-auto"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shadow-lg transition-all backdrop-blur-sm border border-white/20 flex-shrink-0 bg-white/10">
                  {icon && (
                    <svg
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

// 스타일 2: 글래스모피즘 + 그라데이션 배경
function Style2_Glassmorphism() {
  const [isHovered, setIsHovered] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);
      const handleChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);
  
  return (
    <motion.div
      className="overflow-hidden relative max-w-4xl mx-auto"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
            const gradient = vendorGradients[v];
            const iconColor = v === "X(Twitter)" ? "#FFFFFF" : brandColor;
            
            return (
              <motion.div
                key={`${v}-${index}`}
                className="flex items-center gap-2 sm:gap-3 min-w-[100px] sm:min-w-[120px]"
                whileHover={prefersReducedMotion ? {} : { scale: 1.15, y: -8, rotateZ: 5 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              >
                <motion.div
                  className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shadow-2xl backdrop-blur-md border-2 border-white/30 flex-shrink-0 bg-gradient-to-br ${gradient} relative overflow-hidden`}
                  whileHover={{ boxShadow: `0 20px 40px -10px ${brandColor}80` }}
                >
                  {/* 글래스 효과 오버레이 */}
                  <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
                  {/* 내부 글로우 */}
                  <div className="absolute inset-0 bg-gradient-to-br from-transparent to-black/10 rounded-2xl" />
                  
                  {icon && (
                    <svg
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-7 h-7 sm:w-8 sm:h-8 relative z-10 drop-shadow-lg"
                      fill={iconColor}
                    >
                      <path d={icon.path} />
                    </svg>
                  )}
                </motion.div>
                <span className="text-white font-bold font-nanum text-xs sm:text-sm text-center whitespace-nowrap drop-shadow-lg">{v}</span>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </motion.div>
  );
}

// 스타일 3: 3D 카드 효과
function Style3_3DCard() {
  const [isHovered, setIsHovered] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);
      const handleChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);
  
  return (
    <motion.div
      className="overflow-hidden relative max-w-4xl mx-auto"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
            const gradient = vendorGradients[v];
            const iconColor = v === "X(Twitter)" ? "#FFFFFF" : brandColor;
            
            return (
              <motion.div
                key={`${v}-${index}`}
                className="flex flex-col items-center gap-2 sm:gap-3 min-w-[100px] sm:min-w-[120px]"
                whileHover={prefersReducedMotion ? {} : { 
                  scale: 1.2, 
                  y: -10,
                  rotateY: 10,
                  rotateX: 5,
                }}
                style={{ perspective: 1000 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              >
                <motion.div
                  className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center shadow-2xl border-2 border-white/40 flex-shrink-0 bg-gradient-to-br ${gradient} relative overflow-hidden`}
                  whileHover={{ 
                    boxShadow: `0 25px 50px -12px ${brandColor}90`,
                    rotateY: 5,
                  }}
                  style={{ transformStyle: "preserve-3d" }}
                >
                  {/* 3D 효과를 위한 레이어 */}
                  <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-black/20 rounded-2xl" />
                  <div className="absolute inset-[1px] bg-gradient-to-tr from-transparent via-white/10 to-transparent rounded-2xl" />
                  
                  {icon && (
                    <motion.svg
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-8 h-8 sm:w-9 sm:h-9 relative z-10 drop-shadow-2xl"
                      fill={iconColor}
                      whileHover={{ scale: 1.1, rotateZ: 5 }}
                    >
                      <path d={icon.path} />
                    </motion.svg>
                  )}
                </motion.div>
                <motion.span 
                  className="text-white font-bold font-nanum text-xs sm:text-sm text-center whitespace-nowrap drop-shadow-lg"
                  whileHover={{ scale: 1.1 }}
                >
                  {v}
                </motion.span>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </motion.div>
  );
}

// 스타일 4: 미니멀 + 네온 효과
function Style4_MinimalNeon() {
  const [isHovered, setIsHovered] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);
      const handleChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);
  
  return (
    <motion.div
      className="overflow-hidden relative max-w-4xl mx-auto"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
                whileHover={prefersReducedMotion ? {} : { scale: 1.15, y: -8 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              >
                <motion.div
                  className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center border-2 flex-shrink-0 bg-black/40 backdrop-blur-sm relative overflow-hidden"
                  style={{ 
                    borderColor: brandColor,
                    boxShadow: `0 0 20px ${brandColor}40, inset 0 0 20px ${brandColor}20`
                  }}
                  whileHover={{ 
                    boxShadow: `0 0 30px ${brandColor}80, 0 0 60px ${brandColor}40, inset 0 0 30px ${brandColor}30`,
                    borderColor: brandColor,
                  }}
                >
                  {/* 네온 글로우 애니메이션 */}
                  <motion.div
                    className="absolute inset-0 rounded-xl"
                    style={{ 
                      background: `radial-gradient(circle at center, ${brandColor}20 0%, transparent 70%)`,
                    }}
                    animate={{
                      opacity: [0.3, 0.6, 0.3],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                  
                  {icon && (
                    <svg
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-7 h-7 sm:w-8 sm:h-8 relative z-10"
                      fill={iconColor}
                      style={{ filter: `drop-shadow(0 0 8px ${brandColor})` }}
                    >
                      <path d={icon.path} />
                    </svg>
                  )}
                </motion.div>
                <span className="text-white font-bold font-nanum text-xs sm:text-sm text-center whitespace-nowrap">{v}</span>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </motion.div>
  );
}

// 스타일 5: 플로팅 카드 (부유 효과)
function Style5_FloatingCard() {
  const [isHovered, setIsHovered] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);
      const handleChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);
  
  return (
    <motion.div
      className="overflow-hidden relative max-w-4xl mx-auto"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
            const gradient = vendorGradients[v];
            const iconColor = v === "X(Twitter)" ? "#FFFFFF" : brandColor;
            const delay = index * 0.1;
            
            return (
              <motion.div
                key={`${v}-${index}`}
                className="flex flex-col items-center gap-2 sm:gap-3 min-w-[100px] sm:min-w-[120px]"
                initial={{ y: 0 }}
                animate={prefersReducedMotion ? {} : {
                  y: [0, -10, 0],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  delay,
                  ease: "easeInOut",
                }}
                whileHover={prefersReducedMotion ? {} : { 
                  scale: 1.2, 
                  y: -15,
                  rotateZ: -5,
                  transition: { type: "spring", stiffness: 300, damping: 20 }
                }}
              >
                <motion.div
                  className={`w-14 h-14 sm:w-16 sm:h-16 rounded-3xl flex items-center justify-center shadow-2xl border-2 border-white/30 flex-shrink-0 bg-gradient-to-br ${gradient} relative overflow-hidden`}
                  whileHover={{ 
                    boxShadow: `0 20px 60px -15px ${brandColor}90`,
                    rotateY: 15,
                  }}
                >
                  {/* 반사 효과 */}
                  <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-transparent rounded-3xl" />
                  <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent rounded-t-3xl" />
                  
                  {icon && (
                    <motion.svg
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-8 h-8 sm:w-9 sm:h-9 relative z-10 drop-shadow-2xl"
                      fill={iconColor}
                      whileHover={{ scale: 1.15, rotateZ: 10 }}
                    >
                      <path d={icon.path} />
                    </motion.svg>
                  )}
                </motion.div>
                <motion.span 
                  className="text-white font-bold font-nanum text-xs sm:text-sm text-center whitespace-nowrap drop-shadow-lg"
                  whileHover={{ scale: 1.1 }}
                >
                  {v}
                </motion.span>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </motion.div>
  );
}

export default function VendorLogosTestPage() {
  const styles = [
    { id: 1, name: "현재 스타일", component: Style1_Current, description: "기존 메인 페이지에서 사용 중인 스타일" },
    { id: 2, name: "글래스모피즘", component: Style2_Glassmorphism, description: "글래스 효과 + 그라데이션 배경" },
    { id: 3, name: "3D 카드", component: Style3_3DCard, description: "3D 회전 효과와 깊이감" },
    { id: 4, name: "미니멀 네온", component: Style4_MinimalNeon, description: "미니멀 디자인 + 네온 글로우 효과" },
    { id: 5, name: "플로팅 카드", component: Style5_FloatingCard, description: "부유 애니메이션 + 반사 효과" },
  ];

  return (
    <MainLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-indigo-900 py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 font-nanum">
              벤더 로고 스타일 테스트
            </h1>
            <p className="text-lg text-gray-300 font-nanum">
              다양한 스타일의 벤더 로고 표현을 비교해보세요
            </p>
          </motion.div>

          <div className="space-y-16">
            {styles.map((style, index) => {
              const Component = style.component;
              return (
                <motion.div
                  key={style.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                >
                  <Card className="bg-gray-800/50 backdrop-blur-sm border-gray-700/50 shadow-2xl">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-2xl text-white font-nanum mb-2">
                            스타일 {style.id}: {style.name}
                          </CardTitle>
                          <p className="text-gray-400 font-nanum">{style.description}</p>
                        </div>
                        <Badge variant="outline" className="border-blue-500/50 text-blue-300">
                          {style.id === 1 ? "현재 사용 중" : "새 스타일"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-6">
                      <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/80 rounded-2xl p-8 border border-gray-700/50">
                        <Component />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          <motion.div
            className="mt-16 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.8 }}
          >
            <Card className="bg-blue-900/30 backdrop-blur-sm border-blue-500/30">
              <CardContent className="p-6">
                <p className="text-gray-300 font-nanum">
                  💡 <strong>팁:</strong> 각 스타일에 마우스를 올려보면 호버 효과를 확인할 수 있습니다.
                  <br />
                  원하는 스타일을 선택하면 메인 페이지에 적용할 수 있습니다.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </MainLayout>
  );
}

