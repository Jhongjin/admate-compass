"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Activity,
  BarChart3,
  DollarSign,
  FileSearch,
  FileText,
  Menu,
  PieChart,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";

const NAV_ITEMS = [
  { key: "dashboard", label: "대시보드", href: "/admin", icon: BarChart3 },
  { key: "docs", label: "문서 관리", href: "/admin/docs", icon: FileText },
  { key: "queues", label: "처리 큐", href: "/admin/queues", icon: Activity },
  { key: "users", label: "사용자 관리", href: "/admin/users", icon: Users },
  { key: "monitoring", label: "시스템 모니터링", href: "/admin/monitoring", icon: Zap },
  { key: "stats", label: "통계 및 분석", href: "/admin/stats", icon: PieChart },
  { key: "logs", label: "로그 및 감사", href: "/admin/logs", icon: FileSearch },
  { key: "cost", label: "비용 모니터링", href: "/test/admin-cost-monitoring-theme", icon: DollarSign },
] as const;

export type AdminNavKey = (typeof NAV_ITEMS)[number]["key"];

interface AdminThemeLayoutProps {
  children: React.ReactNode;
  currentPage?: AdminNavKey;
  pageTitle?: string;
  statusMessage?: string;
}

const STATUS_TEXT_DEFAULT = "시스템 정상 가동 중";

export default function AdminThemeLayout({
  children,
  currentPage = "dashboard",
  pageTitle,
  statusMessage = STATUS_TEXT_DEFAULT,
}: AdminThemeLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();

  const navigation = useMemo(
    () =>
      NAV_ITEMS.map((item) => ({
        ...item,
        current: item.key === currentPage,
      })),
    [currentPage]
  );

  const activeNav = navigation.find((item) => item.current);
  const headerTitle = pageTitle ?? activeNav?.label ?? "관리자";

  const displayName =
    (user?.user_metadata as { name?: string })?.name ||
    user?.email?.split("@")[0] ||
    "관리자";
  const displayEmail = user?.email || "로그인 필요";
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const SidebarNav = (
    <nav className="p-4 space-y-2">
      {navigation.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
            item.current
              ? "bg-blue-600/10 text-blue-400 border border-blue-500/20 shadow-lg shadow-blue-900/30"
              : "text-gray-400 hover:bg-white/5 hover:text-white"
          }`}
          onClick={() => setSidebarOpen(false)}
        >
          <item.icon
            className={`w-5 h-5 ${
              item.current ? "text-blue-400" : "text-gray-500"
            }`}
          />
          {item.label}
        </Link>
      ))}
    </nav>
  );

  const UserCard = (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/5">
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{displayName}</p>
        <p className="text-xs text-gray-500 truncate">{displayEmail}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white font-sans selection:bg-blue-500/30">
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#0B0F17]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center gap-2 group">
                <div className="relative w-8 h-8">
                  <Image src="/admate-logo.png" alt="AdMate" fill className="object-contain" />
                </div>
                <span className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                  AdMate
                </span>
              </Link>
              <div className="hidden md:flex items-center text-sm text-gray-500">
                <span className="px-2">/</span>
                <span className="text-gray-300">{headerTitle}</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/5">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span className="text-xs font-medium text-gray-300">{statusMessage}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden text-gray-400 hover:text-white"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="pt-20 flex max-w-[1600px] mx-auto">
        <aside className="hidden md:flex w-64 fixed h-[calc(100vh-5rem)] border-r border-white/5 bg-[#0B0F17]/60 backdrop-blur-sm flex-col justify-between">
          <div className="overflow-y-auto">{SidebarNav}</div>
          <div className="p-4 border-t border-white/5">{UserCard}</div>
        </aside>

        <main className="flex-1 md:pl-64 min-h-[calc(100vh-5rem)]">
          <div className="p-6 lg:p-10 space-y-8">{children}</div>
        </main>
      </div>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetTrigger asChild>
          <span />
        </SheetTrigger>
        <SheetContent side="right" className="w-72 sm:w-80 bg-[#0B0F17] text-white border-white/5">
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto">{SidebarNav}</div>
            <div className="border-t border-white/5 p-4">{UserCard}</div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

