"use client";

import { useState } from "react";
import { ArrowLeft, Menu, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import Link from "next/link";
import { motion } from "framer-motion";

interface ChatLayoutProps {
  children: React.ReactNode;
}

export default function ChatLayout({ children }: ChatLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navigation = [
    { name: "홈", href: "/", icon: "🏠" },
    { name: "채팅", href: "/chat", icon: "💬" },
    { name: "히스토리", href: "/history", icon: "📚" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-indigo-900">
      {/* Header - Dark theme with glassmorphism */}
      <header className="bg-black/20 backdrop-blur-md border-b border-white/10 sticky top-0 z-50">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 sm:h-16">
            <div className="flex items-center space-x-2 sm:space-x-3">
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
                    className="h-16 w-auto"
                    whileHover={{
                      filter: "brightness(1.1) drop-shadow(0 4px 8px rgba(255, 107, 53, 0.3))",
                      transition: { duration: 0.2 }
                    }}
                  />
                </motion.div>
              </Link>
              <div className="hidden sm:block">
                <h1 className="text-base sm:text-lg font-semibold text-white truncate">
                  멀티 플랫폼 광고 FAQ 챗봇
                </h1>
              </div>
            </div>
            
            <div className="flex items-center space-x-1 sm:space-x-2">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hidden sm:flex text-white hover:bg-white/10">
                <Settings className="h-4 w-4" />
              </Button>
              
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
                        className="group flex items-center px-3 py-3 text-sm font-medium rounded-lg text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                        onClick={() => setSidebarOpen(false)}
                      >
                        <span className="mr-3 text-lg">{item.icon}</span>
                        {item.name}
                      </Link>
                    ))}
                  </nav>
                  
                  <div className="border-t border-gray-700 pt-4 mt-4">
                    <div className="flex items-center space-x-3 px-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-sm font-medium">사</span>
                      </div>
                      <span className="text-sm text-gray-300">사용자</span>
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
