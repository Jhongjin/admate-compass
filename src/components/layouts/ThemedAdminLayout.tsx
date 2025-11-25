"use client";

import { useState } from "react";
import {
    BarChart3,
    FileText,
    Activity,
    Users,
    Menu
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function ThemedAdminLayout({ children, currentPage = "dashboard" }: { children: React.ReactNode; currentPage?: string }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const navigation = [
        { name: "대시보드", href: "/gemini_pro_theme/admin", icon: BarChart3, current: currentPage === "dashboard" },
        { name: "문서 관리", href: "/gemini_pro_theme/admin/documents", icon: FileText, current: currentPage === "docs" },
        { name: "통계", href: "/gemini_pro_theme/admin/stats", icon: Activity, current: currentPage === "stats" },
        { name: "로그", href: "/gemini_pro_theme/admin/system-logs", icon: Users, current: currentPage === "logs" },
    ];

    return (
        <div className="min-h-screen bg-[#0B0F17] text-white font-sans selection:bg-blue-500/30">
            {/* Header */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-[#0B0F17]/80 backdrop-blur-xl border-b border-white/5">
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-20">
                        <div className="flex items-center gap-8">
                            <Link href="/gemini_pro_theme" className="flex items-center gap-2 group">
                                <div className="relative w-8 h-8">
                                    <Image
                                        src="/admate-logo.png"
                                        alt="AdMate"
                                        fill
                                        className="object-contain"
                                    />
                                </div>
                                <span className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">AdMate</span>
                            </Link>
                            <div className="hidden md:flex items-center text-sm text-gray-500">
                                <span className="px-2">/</span>
                                <span className="text-gray-300">관리자 대시보드</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="hidden md:flex items-center gap-3 px-4 py-2 rounded-full bg-white/5 border border-white/5">
                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                <span className="text-xs font-medium text-gray-300">시스템 정상 가동 중</span>
                            </div>
                            <Button variant="ghost" size="icon" className="md:hidden text-gray-400 hover:text-white" onClick={() => setSidebarOpen(!sidebarOpen)}>
                                <Menu className="w-5 h-5" />
                            </Button>
                        </div>
                    </div>
                </div>
            </header>

            <div className="pt-20 flex max-w-[1600px] mx-auto">
                {/* Sidebar (Desktop) */}
                <aside className="hidden md:block w-64 fixed h-[calc(100vh-5rem)] border-r border-white/5 bg-[#0B0F17]/50 backdrop-blur-sm">
                    <nav className="p-4 space-y-2">
                        {navigation.map((item) => (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${item.current
                                    ? "bg-blue-600/10 text-blue-400 border border-blue-500/20"
                                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                                    }`}
                            >
                                <item.icon className={`w-5 h-5 ${item.current ? "text-blue-400" : "text-gray-500"}`} />
                                {item.name}
                            </Link>
                        ))}
                    </nav>
                    <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/5">
                        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/5">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold">
                                AD
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-white truncate">관리자</p>
                                <p className="text-xs text-gray-500 truncate">admin@admate.ai</p>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Main Content */}
                <main className="flex-1 md:pl-64 min-h-[calc(100vh-5rem)]">
                    <div className="p-6 lg:p-10 space-y-8">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
