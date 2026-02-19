"use client";

import { motion } from "framer-motion";
import MainLayout from "@/components/layouts/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, History, Search, Send } from "lucide-react";
import Link from "next/link";

export default function SimpleHomePage() {
  const router = useRouter();
  const [chatInput, setChatInput] = useState("");

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    
    try {
      const encodedQuestion = encodeURIComponent(chatInput.trim());
      router.push(`/chat?q=${encodedQuestion}`);
    } catch (error) {
      console.error('Chat submit error:', error);
    }
  };

  return (
    <MainLayout>
      {/* Hero Section */}
      <motion.div 
        className="relative w-full min-h-[50vh] flex items-center justify-center overflow-hidden pt-16"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <div className="max-w-5xl mx-auto px-6 text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <div className="inline-flex items-center px-4 py-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white text-sm font-medium mb-8">
              <span className="mr-2">✨</span>
              AI 기반 메타 광고 정책 챗봇
            </div>
          </motion.div>
          
          <motion.h1 
            className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
          >
            Meta 광고 정책
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mt-2">
              대화로 해결하세요
            </span>
          </motion.h1>
          
          <motion.p 
            className="text-xl text-gray-300 mb-8 max-w-4xl mx-auto leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
          >
            복잡한 가이드라인을 뒤질 필요 없이 질문만으로 명확한 답변을 찾아주는 AI 챗봇
          </motion.p>
        </div>
      </motion.div>

      {/* Chat Input Section */}
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
            <form onSubmit={handleChatSubmit} className="w-full">
              <div className="relative w-full">
                <div className="bg-white/5 backdrop-blur-sm border border-white/20 rounded-3xl shadow-2xl overflow-hidden">
                  <div className="p-6">
                    <div className="flex items-center space-x-4">
                      <div className="flex-1 relative">
                        <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-300 w-5 h-5" />
                        <Input
                          type="text"
                          placeholder="메타 광고 정책에 대해 질문해보세요..."
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          className="pl-12 pr-4 py-4 text-base border-0 bg-transparent text-white placeholder-gray-300 focus:ring-0 focus:outline-none rounded-none w-full"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={!chatInput.trim()}
                        className="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-2xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-105"
                      >
                        <div className="flex items-center space-x-2">
                          <Send className="w-4 h-4" />
                          <span>질문하기</span>
                        </div>
                      </Button>
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 text-center">
                  <p className="text-sm text-gray-400">
                    💡 예시: "페이스북 광고 계정 생성 방법", "인스타그램 스토리 광고 크기"
                  </p>
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      </motion.div>

      {/* CTA Section */}
      <motion.div 
        className="text-center py-12"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 1.4 }}
      >
        <div className="bg-white/5 backdrop-blur-sm border border-white/20 rounded-2xl p-12 max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            지금 바로 시작해보세요
          </h2>
          <p className="text-lg text-gray-300 mb-8 max-w-3xl mx-auto">
            Meta 광고 정책에 대한 궁금증을 AI 챗봇에게 물어보고, 업무 효율성을 극대화하세요
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              className="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-2xl transition-all duration-300 shadow-lg hover:scale-105"
            >
              <MessageSquare className="w-5 h-5 mr-2" />
              질문하기
            </Button>
            
            <Link href="/history">
              <Button 
                variant="outline"
                className="px-8 py-4 border-2 border-white/30 text-white hover:bg-white/10 font-semibold rounded-2xl transition-all duration-300 hover:scale-105"
              >
                <History className="w-5 h-5 mr-2" />
                히스토리 보기
              </Button>
            </Link>
          </div>
        </div>
      </motion.div>
    </MainLayout>
  );
}
