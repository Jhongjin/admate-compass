"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LogIn, LogOut, Shield, UserCircle, UserPlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UserProfileDropdownProps {
  user: any;
  loading?: boolean;
  onSignOut: () => void;
}

const ACCESS_REQUEST_URL = "https://home.admate.ai.kr/access-request?product=compass";
const ACCOUNT_URL = "https://sentinel.admate.ai.kr/account";
const ACCESS_REQUESTS_URL = "https://sentinel.admate.ai.kr/users/access-requests";
const ORGANIZATIONS_URL = "https://sentinel.admate.ai.kr/users/organizations";
const USERS_URL = "https://sentinel.admate.ai.kr/users";

export function UserProfileDropdown({ user, loading = false, onSignOut }: UserProfileDropdownProps) {
  const [isAdmin, setIsAdmin] = useState(false);

  const displayName = useMemo(
    () => user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email || "AdMate 계정",
    [user],
  );

  const initials = useMemo(() => {
    const value = displayName?.trim() || "A";
    return value.slice(0, 1).toUpperCase();
  }, [displayName]);

  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!user?.email) {
        setIsAdmin(false);
        return;
      }

      try {
        const response = await fetch("/api/admin/users/check-admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: user.email }),
        });
        const data = await response.json();
        setIsAdmin(data.success && data.isAdmin);
      } catch (error) {
        console.error("관리자 권한 확인 오류:", error);
        setIsAdmin(false);
      }
    };

    checkAdminStatus();
  }, [user?.email]);

  if (loading && !user) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-10 items-center gap-2 rounded-md border border-[#D8DCCF] bg-white/90 px-3 text-sm font-bold text-[#34423A] opacity-70"
      >
        <UserCircle className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">계정 확인 중</span>
      </button>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("openAuthModal", { detail: { mode: "signin" } }))}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[#D8DCCF] bg-white/90 px-3 text-sm font-bold text-[#34423A] transition-colors hover:bg-[#F7FAF6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A4D] focus-visible:ring-offset-2"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">로그인</span>
        </button>
        <Link
          href={ACCESS_REQUEST_URL}
          className="hidden h-10 items-center gap-2 rounded-md bg-[#111713] px-3 text-sm font-bold text-white transition-colors hover:bg-[#223128] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A4D] focus-visible:ring-offset-2 sm:inline-flex"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          AdMate 계정
        </Link>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-10 max-w-[190px] items-center gap-2 rounded-md border border-[#D8DCCF] bg-white/90 px-2.5 text-sm font-semibold text-[#111713] shadow-sm transition-colors hover:bg-[#F7FAF6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A4D] focus-visible:ring-offset-2"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#1F7A4D] text-xs font-black text-white">
            {initials}
          </span>
          <span className="hidden min-w-0 truncate sm:block">{displayName}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 border-[#D8DCCF] bg-white p-2 text-[#111713] shadow-xl">
        <DropdownMenuLabel className="px-3 py-2">
          <span className="block text-sm font-bold text-[#111713]">{displayName}</span>
          <span className="mt-0.5 block truncate text-xs font-medium text-[#68707C]">
            {user?.email || "AdMate 계정"}
          </span>
          <span className="mt-1 block truncate text-xs font-bold text-[#1F7A4D]">Compass 사용 권한</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[#D8DCCF]" />
        {isAdmin ? (
          <>
            <DropdownMenuItem asChild className="cursor-pointer rounded-md focus:bg-[#F4F8F5]">
              <Link href={ACCESS_REQUESTS_URL} className="flex items-center gap-2">
                <Shield className="h-4 w-4" aria-hidden="true" />
                권한 요청 관리
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="cursor-pointer rounded-md focus:bg-[#F4F8F5]">
              <Link href={ORGANIZATIONS_URL} className="flex items-center gap-2">
                <Shield className="h-4 w-4" aria-hidden="true" />
                조직 관리
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="cursor-pointer rounded-md focus:bg-[#F4F8F5]">
              <Link href={USERS_URL} className="flex items-center gap-2">
                <Shield className="h-4 w-4" aria-hidden="true" />
                사용자 관리
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuItem asChild className="cursor-pointer rounded-md focus:bg-[#F4F8F5]">
          <Link href={ACCOUNT_URL} className="flex items-center gap-2">
            <UserCircle className="h-4 w-4" aria-hidden="true" />
            내 계정
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-[#D8DCCF]" />
        <DropdownMenuItem className="cursor-pointer rounded-md focus:bg-[#F4F8F5]" onSelect={onSignOut}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
