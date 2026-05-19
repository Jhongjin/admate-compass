"use client";

import { useState } from "react";
import { FileText, History, Home, Menu, Settings, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import Link from "next/link";
import { motion } from "framer-motion";

interface ChatLayoutProps {
  children: React.ReactNode;
}

export default function ChatLayout({ children }: ChatLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navigation = [
    { name: "홈", href: "/", icon: <Home className="h-4 w-4" /> },
    { name: "정책 확인", href: "/chat", icon: <ShieldCheck className="h-4 w-4" /> },
    { name: "확인 기록", href: "/history", icon: <History className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen bg-[#F4F5F0] text-[#111713]">
      {/* Header - Compass policy answer shell */}
      <header className="sticky top-0 z-50 border-b border-[#D8DCCF] bg-[#FBFBF7]/95 backdrop-blur-md">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between gap-3 sm:h-16">
            <div className="flex min-w-0 items-center space-x-2 sm:space-x-3">
              <Link href="/" className="block shrink-0" aria-label="AdMate Compass 홈으로 이동">
                <motion.div 
                  className="flex h-12 cursor-pointer items-center overflow-hidden sm:h-14"
                  whileHover={{ 
                    scale: 1.02,
                    transition: { duration: 0.3 }
                  }}
                  whileTap={{ scale: 0.95 }}
                >
                  <motion.img 
                    src="/admate-logo.png" 
                    alt="AdMate" 
                    className="max-h-10 w-auto sm:max-h-12"
                    whileHover={{
                      filter: "brightness(1.1) drop-shadow(0 4px 8px rgba(255, 107, 53, 0.3))",
                      transition: { duration: 0.2 }
                    }}
                  />
                </motion.div>
              </Link>
              <div className="hidden min-w-0 sm:block">
                <h1 className="truncate text-base font-semibold text-[#111713] sm:text-lg">
                  Compass 근거 확인 화면
                </h1>
                <p className="text-xs text-[#5F6C62]">정책 답변과 확인한 출처를 함께 확인합니다.</p>
              </div>
            </div>
            
            <div className="flex shrink-0 items-center space-x-1 sm:space-x-2">
              <div className="hidden items-center gap-2 rounded-md border border-[#D8DCCF] bg-white px-2.5 py-1.5 text-xs text-[#34423A] md:flex">
                <span className="h-2 w-2 rounded-full bg-[#1F7A4D]" />
                <span className="font-medium">출처 확인</span>
                <span className="text-[#8A9388]">정책 기준 확인</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label="확인 설정"
                className="hidden h-8 w-8 rounded-md p-0 text-[#5F6C62] hover:bg-[#EDF7EF] hover:text-[#111713] sm:flex"
              >
                <Settings className="h-4 w-4" />
              </Button>
              
              {/* Mobile menu */}
              <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="정책 확인 메뉴 열기"
                    aria-expanded={sidebarOpen}
                    className="h-8 w-8 rounded-md p-0 text-[#5F6C62] hover:bg-[#EDF7EF] hover:text-[#111713] md:hidden"
                  >
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-72 border-[#D8DCCF] bg-[#FBFBF7] sm:w-80">
                  <SheetTitle className="sr-only">Compass 정책 확인 메뉴</SheetTitle>
                  <nav aria-label="Compass 모바일 메뉴" className="flex-1 space-y-1 px-2 py-4">
                    {navigation.map((item) => (
                      <Link
                        key={item.name}
                        href={item.href}
                        className="group flex items-center rounded-lg px-3 py-3 text-sm font-medium text-[#34423A] transition-colors hover:bg-[#EDF7EF] hover:text-[#111713]"
                        onClick={() => setSidebarOpen(false)}
                      >
                        <span className="mr-3 text-[#1F7A4D]">{item.icon}</span>
                        {item.name}
                      </Link>
                    ))}
                  </nav>
                  
                  <div className="mt-4 border-t border-[#D8DCCF] pt-4">
                    <div className="flex items-center space-x-3 px-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[#C6D9CB] bg-[#EDF7EF]">
                        <FileText className="h-4 w-4 text-[#1F7A4D]" />
                      </div>
                      <span className="min-w-0 truncate text-sm text-[#34423A]">정책 확인 세션</span>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>

      {/* Main content - Full width for chat */}
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
