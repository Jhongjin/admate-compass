"use client";

import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { siMeta, siNaver, siKakao, siGoogle, siX } from "simple-icons/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Sparkles, Send, MessageSquare, History, TrendingUp, Users, Clock, FileText, Brain, Shield, Globe } from "lucide-react";
import MainLayout from "@/components/layouts/MainLayout";
import Link from "next/link";

const VENDORS = ["Meta", "Naver", "Kakao", "Google", "X(Twitter)"] as const;

const vendorIcons: Record<string, typeof siMeta> = {
  Meta: siMeta,
  Naver: siNaver,
  Kakao: siKakao,
  Google: siGoogle,
  "X(Twitter)": siX,
};

const vendorColors: Record<string, string> = {
  Meta: "#1877F2",
  Naver: "#03C75A",
  Kakao: "#FEE500",
  Google: "#4285F4",
  "X(Twitter)": "#000000",
};

// 시안 1: 미니멀 화이트/그레이 + 포인트 컬러
function Variant1_MinimalWhite() {
  const [chatInput, setChatInput] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Hero Section */}
      <div className="relative w-full min-h-[60vh] flex items-center justify-center pt-20 pb-16">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center px-4 py-2 bg-blue-50 border border-blue-200 rounded-full text-blue-700 text-sm font-medium mb-6"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            AI 기반 멀티 벤더 광고 정책 챗봇
          </motion.div>
          
          <motion.h1 
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-gray-900 mb-6 leading-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            멀티 플랫폼 광고 정책을
            <span className="block text-blue-600 mt-2">
              대화로 해결하세요
            </span>
          </motion.h1>
          
          <motion.p 
            className="text-lg md:text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
          </motion.p>

          {/* 벤더 로고 - 심플 버전 */}
          <motion.div
            className="flex items-center justify-center gap-6 flex-wrap mb-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            {VENDORS.map((v) => {
              const icon = vendorIcons[v];
              const brandColor = vendorColors[v];
              return (
                <div key={v} className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-xl bg-white border-2 border-gray-200 flex items-center justify-center shadow-sm hover:shadow-md transition-shadow">
                    {icon && (
                      <svg
                        viewBox="0 0 24 24"
                        className="w-6 h-6"
                        fill={brandColor}
                      >
                        <path d={icon.path} />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-gray-600 font-medium">{v}</span>
                </div>
              );
            })}
          </motion.div>

          {/* Chat Input */}
          <motion.div
            className="max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-4 flex items-center gap-3">
              <Search className="w-5 h-5 text-gray-400" />
              <Input
                type="text"
                placeholder="예) 인스타그램 광고 집행 정책..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 border-0 focus-visible:ring-0 text-base"
              />
              <Button className="bg-blue-600 hover:bg-blue-700 text-white px-6">
                <Send className="w-4 h-4 mr-2" />
                질문하기
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

// 시안 2: 부드러운 그라데이션 배경
function Variant2_SoftGradient() {
  const [chatInput, setChatInput] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Hero Section */}
      <div className="relative w-full min-h-[60vh] flex items-center justify-center pt-20 pb-16">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center px-4 py-2 bg-white/80 backdrop-blur-sm border border-blue-200/50 rounded-full text-blue-700 text-sm font-medium mb-6 shadow-sm"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            AI 기반 멀티 벤더 광고 정책 챗봇
          </motion.div>
          
          <motion.h1 
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-gray-900 mb-6 leading-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            멀티 플랫폼 광고 정책을
            <span className="block bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mt-2">
              대화로 해결하세요
            </span>
          </motion.h1>
          
          <motion.p 
            className="text-lg md:text-xl text-gray-700 mb-8 max-w-3xl mx-auto leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
          </motion.p>

          {/* 벤더 로고 */}
          <motion.div
            className="flex items-center justify-center gap-6 flex-wrap mb-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            {VENDORS.map((v) => {
              const icon = vendorIcons[v];
              const brandColor = vendorColors[v];
              return (
                <div key={v} className="flex flex-col items-center gap-2">
                  <div className="w-14 h-14 rounded-xl bg-white/80 backdrop-blur-sm border border-gray-200/50 flex items-center justify-center shadow-md hover:shadow-lg transition-all hover:scale-105">
                    {icon && (
                      <svg
                        viewBox="0 0 24 24"
                        className="w-7 h-7"
                        fill={brandColor}
                      >
                        <path d={icon.path} />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-gray-700 font-medium">{v}</span>
                </div>
              );
            })}
          </motion.div>

          {/* Chat Input */}
          <motion.div
            className="max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200/50 p-4 flex items-center gap-3">
              <Search className="w-5 h-5 text-gray-400" />
              <Input
                type="text"
                placeholder="예) 인스타그램 광고 집행 정책..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 border-0 focus-visible:ring-0 text-base bg-transparent"
              />
              <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-6 shadow-md">
                <Send className="w-4 h-4 mr-2" />
                질문하기
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

// 시안 3: 다크 모드 미니멀
function Variant3_DarkMinimal() {
  const [chatInput, setChatInput] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black">
      {/* Hero Section */}
      <div className="relative w-full min-h-[60vh] flex items-center justify-center pt-20 pb-16">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center px-4 py-2 bg-gray-800 border border-gray-700 rounded-full text-gray-300 text-sm font-medium mb-6"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            AI 기반 멀티 벤더 광고 정책 챗봇
          </motion.div>
          
          <motion.h1 
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            멀티 플랫폼 광고 정책을
            <span className="block text-blue-400 mt-2">
              대화로 해결하세요
            </span>
          </motion.h1>
          
          <motion.p 
            className="text-lg md:text-xl text-gray-400 mb-8 max-w-3xl mx-auto leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
          </motion.p>

          {/* 벤더 로고 */}
          <motion.div
            className="flex items-center justify-center gap-6 flex-wrap mb-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            {VENDORS.map((v) => {
              const icon = vendorIcons[v];
              const brandColor = vendorColors[v];
              return (
                <div key={v} className="flex flex-col items-center gap-2">
                  <div className="w-14 h-14 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center hover:border-gray-600 transition-colors">
                    {icon && (
                      <svg
                        viewBox="0 0 24 24"
                        className="w-7 h-7"
                        fill={brandColor}
                      >
                        <path d={icon.path} />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-gray-400 font-medium">{v}</span>
                </div>
              );
            })}
          </motion.div>

          {/* Chat Input */}
          <motion.div
            className="max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4 flex items-center gap-3">
              <Search className="w-5 h-5 text-gray-500" />
              <Input
                type="text"
                placeholder="예) 인스타그램 광고 집행 정책..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 border-0 focus-visible:ring-0 text-base bg-transparent text-white placeholder:text-gray-500"
              />
              <Button className="bg-blue-600 hover:bg-blue-700 text-white px-6">
                <Send className="w-4 h-4 mr-2" />
                질문하기
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

// 시안 4: 글래스모피즘 심플
function Variant4_Glassmorphism() {
  const [chatInput, setChatInput] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100 relative overflow-hidden">
      {/* 배경 패턴 */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-500 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-purple-500 rounded-full blur-3xl"></div>
      </div>

      {/* Hero Section */}
      <div className="relative w-full min-h-[60vh] flex items-center justify-center pt-20 pb-16 z-10">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center px-4 py-2 bg-white/30 backdrop-blur-md border border-white/40 rounded-full text-gray-800 text-sm font-medium mb-6 shadow-lg"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            AI 기반 멀티 벤더 광고 정책 챗봇
          </motion.div>
          
          <motion.h1 
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-gray-900 mb-6 leading-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            멀티 플랫폼 광고 정책을
            <span className="block bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent mt-2">
              대화로 해결하세요
            </span>
          </motion.h1>
          
          <motion.p 
            className="text-lg md:text-xl text-gray-700 mb-8 max-w-3xl mx-auto leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
          </motion.p>

          {/* 벤더 로고 */}
          <motion.div
            className="flex items-center justify-center gap-6 flex-wrap mb-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            {VENDORS.map((v) => {
              const icon = vendorIcons[v];
              const brandColor = vendorColors[v];
              return (
                <div key={v} className="flex flex-col items-center gap-2">
                  <div className="w-14 h-14 rounded-xl bg-white/40 backdrop-blur-md border border-white/50 flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-105">
                    {icon && (
                      <svg
                        viewBox="0 0 24 24"
                        className="w-7 h-7"
                        fill={brandColor}
                      >
                        <path d={icon.path} />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-gray-800 font-medium">{v}</span>
                </div>
              );
            })}
          </motion.div>

          {/* Chat Input */}
          <motion.div
            className="max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <div className="bg-white/40 backdrop-blur-md rounded-2xl shadow-2xl border border-white/50 p-4 flex items-center gap-3">
              <Search className="w-5 h-5 text-gray-600" />
              <Input
                type="text"
                placeholder="예) 인스타그램 광고 집행 정책..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 border-0 focus-visible:ring-0 text-base bg-transparent text-gray-900 placeholder:text-gray-600"
              />
              <Button className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-6 shadow-lg">
                <Send className="w-4 h-4 mr-2" />
                질문하기
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

// 시안 5: 네오모피즘 (Neumorphism)
function Variant5_Neumorphism() {
  const [chatInput, setChatInput] = useState("");

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Hero Section */}
      <div className="relative w-full min-h-[60vh] flex items-center justify-center pt-20 pb-16">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center px-4 py-2 bg-gray-100 rounded-full text-gray-700 text-sm font-medium mb-6 shadow-[inset_2px_2px_4px_rgba(0,0,0,0.1),inset_-2px_-2px_4px_rgba(255,255,255,0.9)]"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            AI 기반 멀티 벤더 광고 정책 챗봇
          </motion.div>
          
          <motion.h1 
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-gray-800 mb-6 leading-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            멀티 플랫폼 광고 정책을
            <span className="block text-blue-600 mt-2">
              대화로 해결하세요
            </span>
          </motion.h1>
          
          <motion.p 
            className="text-lg md:text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
          </motion.p>

          {/* 벤더 로고 */}
          <motion.div
            className="flex items-center justify-center gap-6 flex-wrap mb-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            {VENDORS.map((v) => {
              const icon = vendorIcons[v];
              const brandColor = vendorColors[v];
              return (
                <div key={v} className="flex flex-col items-center gap-2">
                  <div className="w-14 h-14 rounded-xl bg-gray-100 flex items-center justify-center shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)] hover:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.1),inset_-4px_-4px_8px_rgba(255,255,255,0.9)] transition-all">
                    {icon && (
                      <svg
                        viewBox="0 0 24 24"
                        className="w-7 h-7"
                        fill={brandColor}
                      >
                        <path d={icon.path} />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-gray-700 font-medium">{v}</span>
                </div>
              );
            })}
          </motion.div>

          {/* Chat Input */}
          <motion.div
            className="max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <div className="bg-gray-100 rounded-2xl p-4 flex items-center gap-3 shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.9)]">
              <Search className="w-5 h-5 text-gray-500" />
              <Input
                type="text"
                placeholder="예) 인스타그램 광고 집행 정책..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 border-0 focus-visible:ring-0 text-base bg-gray-100 shadow-[inset_2px_2px_4px_rgba(0,0,0,0.1),inset_-2px_-2px_4px_rgba(255,255,255,0.9)] rounded-xl"
              />
              <Button className="bg-blue-600 hover:bg-blue-700 text-white px-6 shadow-lg">
                <Send className="w-4 h-4 mr-2" />
                질문하기
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

// 시안 6: 모노크롬 + 포인트 컬러
function Variant6_Monochrome() {
  const [chatInput, setChatInput] = useState("");

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <div className="relative w-full min-h-[60vh] flex items-center justify-center pt-20 pb-16 border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center px-4 py-2 bg-gray-100 rounded-full text-gray-700 text-sm font-medium mb-6"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            AI 기반 멀티 벤더 광고 정책 챗봇
          </motion.div>
          
          <motion.h1 
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-gray-900 mb-6 leading-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            멀티 플랫폼 광고 정책을
            <span className="block text-blue-600 mt-2">
              대화로 해결하세요
            </span>
          </motion.h1>
          
          <motion.p 
            className="text-lg md:text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            질문만 입력하면 AI가 적합한 플랫폼을 자동으로 감지해 정확한 답변을 제공합니다
          </motion.p>

          {/* 벤더 로고 - 모노크롬 스타일 */}
          <motion.div
            className="flex items-center justify-center gap-8 flex-wrap mb-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            {VENDORS.map((v) => {
              const icon = vendorIcons[v];
              return (
                <div key={v} className="flex flex-col items-center gap-2">
                  <div className="w-16 h-16 rounded-lg bg-gray-900 flex items-center justify-center hover:bg-gray-800 transition-colors">
                    {icon && (
                      <svg
                        viewBox="0 0 24 24"
                        className="w-8 h-8"
                        fill="white"
                      >
                        <path d={icon.path} />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-gray-700 font-semibold">{v}</span>
                </div>
              );
            })}
          </motion.div>

          {/* Chat Input */}
          <motion.div
            className="max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <div className="bg-white border-2 border-gray-200 rounded-2xl p-4 flex items-center gap-3 hover:border-blue-500 transition-colors">
              <Search className="w-5 h-5 text-gray-400" />
              <Input
                type="text"
                placeholder="예) 인스타그램 광고 집행 정책..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 border-0 focus-visible:ring-0 text-base"
              />
              <Button className="bg-gray-900 hover:bg-gray-800 text-white px-8 py-6 rounded-xl">
                <Send className="w-4 h-4 mr-2" />
                질문하기
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default function MainDesignVariantsPage() {
  const variants = [
    { id: 1, name: "미니멀 화이트", component: Variant1_MinimalWhite, description: "깔끔한 화이트 배경에 포인트 컬러로 강조" },
    { id: 2, name: "부드러운 그라데이션", component: Variant2_SoftGradient, description: "부드러운 파스텔 그라데이션 배경" },
    { id: 3, name: "다크 미니멀", component: Variant3_DarkMinimal, description: "세련된 다크 모드 디자인" },
    { id: 4, name: "글래스모피즘", component: Variant4_Glassmorphism, description: "반투명 글래스 효과" },
    { id: 5, name: "네오모피즘", component: Variant5_Neumorphism, description: "부드러운 그림자 효과" },
    { id: 6, name: "모노크롬", component: Variant6_Monochrome, description: "흑백 기반에 포인트 컬러" },
  ];

  return (
    <MainLayout>
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              메인 페이지 디자인 시안
            </h1>
            <p className="text-lg text-gray-600">
              다양한 스타일의 심플하고 세련된 디자인을 비교해보세요
            </p>
          </motion.div>

          <div className="space-y-16">
            {variants.map((variant, index) => {
              const Component = variant.component;
              return (
                <motion.div
                  key={variant.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                >
                  <Card className="bg-white shadow-xl border-0 overflow-hidden">
                    <CardHeader className="bg-gray-50 border-b">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-2xl text-gray-900 mb-2">
                            시안 {variant.id}: {variant.name}
                          </CardTitle>
                          <p className="text-gray-600">{variant.description}</p>
                        </div>
                        <Badge variant="outline" className="border-blue-500 text-blue-600">
                          {variant.id === 1 ? "추천" : "새 시안"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="border-t border-gray-200">
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
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-6">
                <p className="text-gray-700">
                  💡 <strong>팁:</strong> 각 시안을 스크롤하여 전체 디자인을 확인하세요.
                  <br />
                  원하는 시안을 선택하면 메인 페이지에 적용할 수 있습니다.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </MainLayout>
  );
}

