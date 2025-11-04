"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, Check } from "lucide-react";
import MainLayout from "@/components/layouts/MainLayout";

const VENDORS = ["Meta", "Naver", "Kakao", "Google", "X(Twitter)"] as const;

export default function HeroVendorPreviewPage() {
  const [selectedVersion, setSelectedVersion] = useState<number>(1);

  const versions = [
    { id: 1, name: "옵션 1: 숫자 + 간략 표현" },
    { id: 2, name: "옵션 2: '주요 플랫폼' 표현" },
    { id: 3, name: "옵션 3: 간단한 나열 (3개만)" },
    { id: 4, name: "옵션 4: 멀티 플랫폼 강조" },
    { id: 5, name: "옵션 5: 제목 단순화 + 하단 정보" },
    { id: 6, name: "옵션 6: 툴팁/호버 방식" },
    { id: 7, name: "사용자 제안: 로고 배너 애니메이션" },
  ];

  return (
    <MainLayout>
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-blue-900 to-gray-900 py-12">
        <div className="max-w-7xl mx-auto px-6">
          {/* 헤더 */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-white mb-4 font-nanum">
              히어로 섹션 벤더 표시 옵션 미리보기
            </h1>
            <p className="text-gray-300 font-nanum">
              각 옵션을 선택하여 미리보기를 확인하세요
            </p>
          </div>

          {/* 버전 선택 탭 */}
          <div className="flex flex-wrap gap-3 justify-center mb-12">
            {versions.map((version) => (
              <Button
                key={version.id}
                onClick={() => setSelectedVersion(version.id)}
                variant={selectedVersion === version.id ? "default" : "outline"}
                className={`font-nanum ${
                  selectedVersion === version.id
                    ? "bg-blue-600 text-white"
                    : "border-white/30 text-white hover:bg-white/10"
                }`}
              >
                {version.name}
              </Button>
            ))}
          </div>

          {/* 미리보기 영역 */}
          <div className="relative w-full min-h-[60vh] flex items-center justify-center overflow-hidden bg-gradient-to-b from-gray-900 via-blue-900/50 to-gray-900 rounded-3xl border border-white/10 p-8">
            {selectedVersion === 1 && <Option1 />}
            {selectedVersion === 2 && <Option2 />}
            {selectedVersion === 3 && <Option3 />}
            {selectedVersion === 4 && <Option4 />}
            {selectedVersion === 5 && <Option5 />}
            {selectedVersion === 6 && <Option6 />}
            {selectedVersion === 7 && <Option7LogoBanner />}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}

// 옵션 1: 숫자 + 간략 표현
function Option1() {
  return (
    <div className="max-w-5xl mx-auto text-center relative z-10">
      <div className="inline-flex items-center px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white text-sm font-medium mb-8">
        <Sparkles className="w-4 h-4 mr-2" />
        AI 기반 멀티 벤더 광고 정책 챗봇
      </div>
      
      <motion.h1 
        className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        광고 정책을
        <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mt-2">
          대화로 해결하세요
        </span>
      </motion.h1>
      
      <motion.p 
        className="text-xl text-gray-300 mb-4 max-w-4xl mx-auto leading-relaxed font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      >
        질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
      </motion.p>

      <motion.p
        className="text-sm text-gray-400 font-nanum"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.4 }}
      >
        Meta, Naver, Kakao, Google, X 등 <span className="text-blue-400 font-semibold">5개 플랫폼</span> 지원
      </motion.p>
    </div>
  );
}

// 옵션 2: '주요 플랫폼' 표현
function Option2() {
  return (
    <div className="max-w-5xl mx-auto text-center relative z-10">
      <div className="inline-flex items-center px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white text-sm font-medium mb-8">
        <Sparkles className="w-4 h-4 mr-2" />
        AI 기반 멀티 벤더 광고 정책 챗봇
      </div>
      
      <motion.h1 
        className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        모든 주요 광고 플랫폼 정책을
        <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mt-2">
          대화로 해결하세요
        </span>
      </motion.h1>
      
      <motion.p 
        className="text-xl text-gray-300 mb-8 max-w-4xl mx-auto leading-relaxed font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      >
        질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
      </motion.p>

      <motion.div
        className="flex flex-wrap items-center justify-center gap-3"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.4 }}
      >
        {VENDORS.map((v, i) => (
          <Badge 
            key={v} 
            className="bg-white/10 border-white/20 text-white px-4 py-2 text-sm font-nanum hover:bg-white/20 transition-all"
          >
            {v}
          </Badge>
        ))}
      </motion.div>
    </div>
  );
}

// 옵션 3: 간단한 나열 (3개만)
function Option3() {
  return (
    <div className="max-w-5xl mx-auto text-center relative z-10">
      <div className="inline-flex items-center px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white text-sm font-medium mb-8">
        <Sparkles className="w-4 h-4 mr-2" />
        AI 기반 멀티 벤더 광고 정책 챗봇
      </div>
      
      <motion.h1 
        className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        Meta · Naver · Google 외 광고 정책을
        <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mt-2">
          대화로 해결하세요
        </span>
      </motion.h1>
      
      <motion.p 
        className="text-xl text-gray-300 mb-4 max-w-4xl mx-auto leading-relaxed font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      >
        질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
      </motion.p>

      <motion.p
        className="text-sm text-gray-400 font-nanum"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.4 }}
      >
        총 <span className="text-blue-400 font-semibold">5개 플랫폼</span> 지원
      </motion.p>
    </div>
  );
}

// 옵션 4: 멀티 플랫폼 강조
function Option4() {
  return (
    <div className="max-w-5xl mx-auto text-center relative z-10">
      <div className="inline-flex items-center px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white text-sm font-medium mb-8">
        <Sparkles className="w-4 h-4 mr-2" />
        AI 기반 멀티 벤더 광고 정책 챗봇
      </div>
      
      <motion.h1 
        className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        멀티 플랫폼 광고 정책을
        <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mt-2">
          대화로 해결하세요
        </span>
      </motion.h1>
      
      <motion.p 
        className="text-xl text-gray-300 mb-8 max-w-4xl mx-auto leading-relaxed font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      >
        질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
      </motion.p>

      <motion.div
        className="grid grid-cols-5 gap-4 max-w-2xl mx-auto"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.4 }}
      >
        {VENDORS.map((v, i) => (
          <div 
            key={v}
            className="flex flex-col items-center gap-2 p-4 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 transition-all"
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-lg ${
              v === "Meta" ? "bg-blue-600" :
              v === "Naver" ? "bg-green-600" :
              v === "Kakao" ? "bg-yellow-500" :
              v === "Google" ? "bg-red-600" :
              "bg-gray-700"
            }`}>
              {v[0]}
            </div>
            <span className="text-xs text-gray-300 font-nanum">{v}</span>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

// 옵션 5: 제목 단순화 + 하단 정보
function Option5() {
  return (
    <div className="max-w-5xl mx-auto text-center relative z-10">
      <div className="inline-flex items-center px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white text-sm font-medium mb-8">
        <Sparkles className="w-4 h-4 mr-2" />
        AI 기반 멀티 벤더 광고 정책 챗봇
      </div>
      
      <motion.h1 
        className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        광고 정책을
        <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mt-2">
          대화로 해결하세요
        </span>
      </motion.h1>
      
      <motion.p 
        className="text-xl text-gray-300 mb-8 max-w-4xl mx-auto leading-relaxed font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      >
        질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
      </motion.p>

      <motion.div
        className="flex items-center justify-center gap-6 text-sm text-gray-400 font-nanum"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.4 }}
      >
        <span className="flex items-center gap-2">
          <Check className="w-4 h-4 text-green-400" />
          Meta
        </span>
        <span className="flex items-center gap-2">
          <Check className="w-4 h-4 text-green-400" />
          Naver
        </span>
        <span className="flex items-center gap-2">
          <Check className="w-4 h-4 text-green-400" />
          Kakao
        </span>
        <span className="flex items-center gap-2">
          <Check className="w-4 h-4 text-green-400" />
          Google
        </span>
        <span className="flex items-center gap-2">
          <Check className="w-4 h-4 text-green-400" />
          X
        </span>
      </motion.div>
    </div>
  );
}

// 옵션 6: 툴팁/호버 방식
function Option6() {
  const [showVendors, setShowVendors] = useState(false);
  
  return (
    <div className="max-w-5xl mx-auto text-center relative z-10">
      <div className="inline-flex items-center px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white text-sm font-medium mb-8">
        <Sparkles className="w-4 h-4 mr-2" />
        AI 기반 멀티 벤더 광고 정책 챗봇
      </div>
      
      <motion.h1 
        className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        멀티 벤더 광고 정책을
        <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mt-2">
          대화로 해결하세요
        </span>
      </motion.h1>
      
      <motion.p 
        className="text-xl text-gray-300 mb-4 max-w-4xl mx-auto leading-relaxed font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      >
        질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
      </motion.p>

      <motion.button
        onClick={() => setShowVendors(!showVendors)}
        onMouseEnter={() => setShowVendors(true)}
        onMouseLeave={() => setShowVendors(false)}
        className="text-sm text-blue-400 hover:text-blue-300 font-nanum underline decoration-dotted"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.4 }}
      >
        지원 플랫폼 보기
      </motion.button>

      {showVendors && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="mt-4 p-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl"
        >
          <div className="flex flex-wrap items-center justify-center gap-3">
            {VENDORS.map((v) => (
              <Badge 
                key={v} 
                className="bg-white/10 border-white/20 text-white font-nanum"
              >
                {v}
              </Badge>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// 옵션 7: 사용자 제안 - 로고 배너 애니메이션 (애니메이션 + 정적 버전)
function Option7LogoBanner() {
  const [isAnimated, setIsAnimated] = useState(true);
  const vendorLogos = [...VENDORS, ...VENDORS]; // 무한 루프를 위한 복제
  
  return (
    <div className="max-w-5xl mx-auto text-center relative z-10 w-full">
      <div className="inline-flex items-center px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white text-sm font-medium mb-8">
        <Sparkles className="w-4 h-4 mr-2" />
        AI 기반 멀티 벤더 광고 정책 챗봇
      </div>
      
      {/* 애니메이션/정적 토글 버튼 */}
      <div className="flex justify-center mb-6">
        <div className="inline-flex items-center gap-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-full p-1">
          <button
            onClick={() => setIsAnimated(true)}
            className={`px-4 py-2 rounded-full text-xs font-nanum transition-all ${
              isAnimated
                ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg"
                : "text-gray-300 hover:text-white"
            }`}
          >
            애니메이션
          </button>
          <button
            onClick={() => setIsAnimated(false)}
            className={`px-4 py-2 rounded-full text-xs font-nanum transition-all ${
              !isAnimated
                ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg"
                : "text-gray-300 hover:text-white"
            }`}
          >
            정적
          </button>
        </div>
      </div>

      {/* 로고 배너 */}
      <motion.div
        className="mb-8 overflow-hidden relative"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      >
        <div className="relative w-full h-24 flex items-center">
          {isAnimated ? (
            // 좌로 이동하는 무한 애니메이션
            <motion.div
              className="flex items-center gap-6 whitespace-nowrap"
              animate={{
                x: [0, -1000], // 적절한 거리만큼 이동
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
              {vendorLogos.map((vendor, index) => (
                <motion.div
                  key={`${vendor}-${index}`}
                  className="flex items-center gap-3 px-6 py-4 bg-gradient-to-r from-white/10 to-white/5 backdrop-blur-md border border-white/20 rounded-2xl hover:bg-white/20 transition-all shadow-lg"
                  whileHover={{ scale: 1.05, y: -5 }}
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white text-lg shadow-lg ${
                    vendor === "Meta" ? "bg-gradient-to-br from-blue-600 to-blue-700" :
                    vendor === "Naver" ? "bg-gradient-to-br from-green-600 to-green-700" :
                    vendor === "Kakao" ? "bg-gradient-to-br from-yellow-500 to-yellow-600" :
                    vendor === "Google" ? "bg-gradient-to-br from-red-600 to-red-700" :
                    "bg-gradient-to-br from-gray-700 to-gray-800"
                  }`}>
                    {vendor[0]}
                  </div>
                  <span className="text-white font-semibold font-nanum text-base">{vendor}</span>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            // 정적 버전 - 가로 정렬
            <div className="flex items-center justify-center gap-4 flex-wrap w-full">
              {VENDORS.map((v) => (
                <motion.div
                  key={v}
                  className="flex items-center gap-3 px-5 py-3 bg-gradient-to-r from-white/10 to-white/5 backdrop-blur-md border border-white/20 rounded-xl hover:bg-white/20 transition-all shadow-lg"
                  whileHover={{ scale: 1.05, y: -5 }}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-base shadow-lg ${
                    v === "Meta" ? "bg-gradient-to-br from-blue-600 to-blue-700" :
                    v === "Naver" ? "bg-gradient-to-br from-green-600 to-green-700" :
                    v === "Kakao" ? "bg-gradient-to-br from-yellow-500 to-yellow-600" :
                    v === "Google" ? "bg-gradient-to-br from-red-600 to-red-700" :
                    "bg-gradient-to-br from-gray-700 to-gray-800"
                  }`}>
                    {v[0]}
                  </div>
                  <span className="text-white font-semibold font-nanum text-sm">{v}</span>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
      
      <motion.h1 
        className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      >
        광고 정책을
        <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mt-2">
          대화로 해결하세요
        </span>
      </motion.h1>
      
      <motion.p 
        className="text-xl text-gray-300 mb-8 max-w-4xl mx-auto leading-relaxed font-nanum"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.4 }}
      >
        질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
      </motion.p>
    </div>
  );
}

