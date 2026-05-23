"use client";

import { useMemo } from "react";
import Link from "next/link";
import { buildCompassCoreAuthStartPath } from "@/lib/auth/coreStartPath";
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
  const compassAuthStartPath = buildCompassCoreAuthStartPath("/desk");

  const displayName = useMemo(
    () => user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email || "AdMate 계정",
    [user],
  );

  const rolesLabel = useMemo(
    () => user?.user_metadata?.admate_roles_label || "Compass 사용 권한",
    [user],
  );

  const adminNavigation = useMemo(() => {
    const value = user?.user_metadata?.admate_admin_navigation as
      | {
          canManageAccessRequests?: unknown;
          canManageOrganizations?: unknown;
          canManageUsers?: unknown;
        }
      | undefined;

    return {
      canManageAccessRequests: Boolean(value?.canManageAccessRequests),
      canManageOrganizations: Boolean(value?.canManageOrganizations),
      canManageUsers: Boolean(value?.canManageUsers),
    };
  }, [user]);

  if (loading && !user) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-10 items-center rounded-md border border-[#D8DCCF] bg-white/90 px-3 text-sm font-bold text-[#34423A] opacity-70"
      >
        <span className="hidden sm:inline">계정 확인 중</span>
      </button>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href={compassAuthStartPath}
          className="inline-flex h-10 items-center rounded-md border border-[#D8DCCF] bg-white/90 px-4 text-sm font-bold text-[#34423A] transition-colors hover:bg-[#F7FAF6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A4D] focus-visible:ring-offset-2"
        >
          <span className="hidden sm:inline">로그인</span>
        </Link>
        <Link
          href={ACCESS_REQUEST_URL}
          className="hidden h-10 items-center rounded-md bg-[#111713] px-4 text-sm font-bold text-white transition-colors hover:bg-[#223128] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A4D] focus-visible:ring-offset-2 sm:inline-flex"
        >
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
          className="inline-flex h-10 max-w-[190px] items-center rounded-md border border-[#D8DCCF] bg-white/90 px-4 text-sm font-semibold text-[#111713] shadow-sm transition-colors hover:bg-[#F7FAF6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A4D] focus-visible:ring-offset-2"
        >
          <span className="min-w-0 truncate">{displayName}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 border-[#D8DCCF] bg-white p-2 text-[#111713] shadow-xl">
        <DropdownMenuLabel className="px-3 py-2">
          <span className="block text-sm font-bold text-[#111713]">{displayName}</span>
          <span className="mt-0.5 block truncate text-xs font-medium text-[#68707C]">
            {user?.email || "AdMate 계정"}
          </span>
          <span className="mt-1 block truncate text-xs font-bold text-[#1F7A4D]">{rolesLabel}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[#D8DCCF]" />
        {adminNavigation.canManageAccessRequests ? (
          <DropdownMenuItem asChild className="cursor-pointer rounded-md px-3 py-2 text-sm font-semibold focus:bg-[#F4F8F5]">
            <Link href={ACCESS_REQUESTS_URL}>권한 요청 관리</Link>
          </DropdownMenuItem>
        ) : null}
        {adminNavigation.canManageOrganizations ? (
          <DropdownMenuItem asChild className="cursor-pointer rounded-md px-3 py-2 text-sm font-semibold focus:bg-[#F4F8F5]">
            <Link href={ORGANIZATIONS_URL}>조직 관리</Link>
          </DropdownMenuItem>
        ) : null}
        {adminNavigation.canManageUsers ? (
          <DropdownMenuItem asChild className="cursor-pointer rounded-md px-3 py-2 text-sm font-semibold focus:bg-[#F4F8F5]">
            <Link href={USERS_URL}>사용자 관리</Link>
          </DropdownMenuItem>
        ) : null}
        {adminNavigation.canManageAccessRequests ||
        adminNavigation.canManageOrganizations ||
        adminNavigation.canManageUsers ? (
          <DropdownMenuSeparator className="bg-[#D8DCCF]" />
        ) : null}
        <DropdownMenuItem asChild className="cursor-pointer rounded-md px-3 py-2 text-sm font-semibold focus:bg-[#F4F8F5]">
          <Link href={ACCOUNT_URL}>내 계정</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-[#D8DCCF]" />
        <DropdownMenuItem className="cursor-pointer rounded-md px-3 py-2 text-sm font-semibold focus:bg-[#F4F8F5]" onSelect={onSignOut}>
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
