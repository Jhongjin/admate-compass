"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import "@/app/admin/globals.admin.css";
import { Menu, BarChart3, FileText, Activity, Users, LogOut, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import Link from "next/link";

interface AdminLayoutProps {
  children: React.ReactNode;
  currentPage?: string;
}

export default function AdminLayout({ children, currentPage = "dashboard" }: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navigation = [
    { name: "대시보드", href: "/admin", icon: BarChart3, current: currentPage === "dashboard" },
    { name: "문서 관리", href: "/admin/docs", icon: FileText, current: currentPage === "docs" },
    { name: "통계", href: "/admin/stats", icon: Activity, current: currentPage === "stats" },
    { name: "로그", href: "/admin/logs", icon: Users, current: currentPage === "logs" },
  ];

  return (
    <div className="admin-container min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Header - Modern glassmorphism design */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/20 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 py-3">
            {/* AdMate 로고 - 완전히 왼쪽으로 이동 */}
            <div className="flex items-center">
              <Link href="/" className="block">
                <motion.div 
                  className="cursor-pointer"
                  whileHover={{ 
                    scale: 1.05,
                    transition: { duration: 0.3 }
                  }}
                  whileTap={{ scale: 0.95 }}
                >
                  <motion.img 
                    src="/admate-logo.png" 
                    alt="AdMate" 
                    className="h-24 w-auto"
                    whileHover={{
                      filter: "brightness(1.1) drop-shadow(0 4px 8px rgba(255, 107, 53, 0.3))",
                      transition: { duration: 0.2 }
                    }}
                  />
                </motion.div>
              </Link>
            </div>
            
            {/* 관리자 대시보드 텍스트 - 우측으로 이동 */}
            <div className="flex items-center space-x-2">
              <div className="hidden md:block text-right">
                <h1 className="text-lg font-semibold text-white">관리자 대시보드</h1>
                <p className="text-xs text-gray-300">시스템 관리 및 모니터링</p>
              </div>
              
              {/* Mobile menu */}
              <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="md:hidden h-8 w-8 p-0 text-white hover:bg-white/10">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-72 sm:w-80 bg-gray-900/95 backdrop-blur-md border-gray-700">
                  <nav className="flex-1 px-2 py-4 space-y-1">
                    {navigation.map((item) => (
                      <Link
                        key={item.name}
                        href={item.href}
                        className={`group flex items-center px-3 py-3 text-sm font-medium rounded-lg transition-colors ${
                          item.current
                            ? "bg-red-500/20 text-red-300 border border-red-500/30"
                            : "text-gray-300 hover:bg-white/10 hover:text-white"
                        }`}
                        onClick={() => setSidebarOpen(false)}
                      >
                        <item.icon
                          className={`mr-3 flex-shrink-0 h-5 w-5 ${
                            item.current ? "text-red-400" : "text-gray-400 group-hover:text-gray-300"
                          }`}
                        />
                        {item.name}
                      </Link>
                    ))}
                  </nav>
                  
                  <div className="border-t border-gray-700 pt-4 mt-4">
                    <div className="flex items-center space-x-3 px-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-pink-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-sm font-medium">관</span>
                      </div>
                      <span className="text-sm text-gray-300">관리자</span>
                    </div>
                    <div className="mt-2 px-3">
                      <div className="text-xs text-gray-400">
                        <p className="font-medium">시스템 상태</p>
                        <p className="mt-1 text-green-400">🟢 정상 운영 중</p>
                        <p className="mt-1">마지막 업데이트: 방금 전</p>
                      </div>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>

      <div className="flex pt-16">
        {/* Sidebar - Desktop */}
        <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 md:pt-16">
          <div className="flex-1 flex flex-col min-h-0 bg-gray-900/80 backdrop-blur-md border-r border-gray-700/50">
            <nav className="flex-1 px-2 py-4 space-y-1">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`group flex items-center px-3 py-3 text-sm font-medium rounded-lg transition-all duration-200 ${
                    item.current
                      ? "bg-red-500/20 text-red-300 border border-red-500/30 shadow-lg"
                      : "text-gray-300 hover:bg-white/10 hover:text-white hover:shadow-md"
                  }`}
                >
                  <item.icon
                    className={`mr-3 flex-shrink-0 h-5 w-5 transition-colors ${
                      item.current ? "text-red-400" : "text-gray-400 group-hover:text-gray-300"
                    }`}
                  />
                  {item.name}
                </Link>
              ))}
            </nav>
            
            {/* Admin info */}
            <div className="border-t border-gray-700/50 p-4">
              <div className="text-xs text-gray-400">
                <p className="font-medium text-white">시스템 상태</p>
                <p className="mt-1 text-green-400">🟢 정상 운영 중</p>
                <p className="mt-1">마지막 업데이트: 방금 전</p>
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="md:pl-64 flex-1">
          <main className="py-6">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
