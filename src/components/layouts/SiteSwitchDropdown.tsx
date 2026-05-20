"use client";

import Link from "next/link";
import { ChevronDown, Compass, Home, LineChart, Radar, ScanLine, Sparkles, UserPlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const sites = [
  {
    label: "AdMate Home",
    description: "제품군 안내와 공지",
    href: "https://home.admate.ai.kr",
    icon: Home,
    active: false,
  },
  {
    label: "이용 권한 요청",
    description: "필요한 제품 권한 신청",
    href: "https://home.admate.ai.kr/access-request?product=compass",
    icon: UserPlus,
    active: false,
  },
  {
    label: "Compass",
    description: "광고 정책 근거 확인",
    href: "https://compass.admate.ai.kr",
    icon: Compass,
    active: true,
  },
  {
    label: "Sentinel",
    description: "실시간 관제와 사전 검수",
    href: "https://sentinel.admate.ai.kr",
    icon: Radar,
    active: false,
  },
  {
    label: "Lens",
    description: "캡처 검수와 작업 기록",
    href: "https://lens.admate.ai.kr",
    icon: ScanLine,
    active: false,
  },
  {
    label: "Foresight",
    description: "성과 예측과 기준선 관리",
    href: "https://foresight.admate.ai.kr",
    icon: LineChart,
    active: false,
  },
] as const;

export function SiteSwitchDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="사이트 이동"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[#D7DCE3] bg-white/88 px-3 text-sm font-semibold text-[#293B5A] shadow-sm transition-colors hover:border-[#C4CEDA] hover:bg-[#F8F6F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2764D9] focus-visible:ring-offset-2"
        >
          <Sparkles className="h-4 w-4 text-[#A67B2D]" aria-hidden="true" />
          <span className="hidden sm:inline">사이트 이동</span>
          <ChevronDown className="h-4 w-4 text-[#68707C]" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 border-[#D7DCE3] bg-white p-2 text-[#172033] shadow-xl">
        <DropdownMenuLabel className="px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-[#68707C]">
          AdMate Suite
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[#E3E6EA]" />
        {sites.map((site) => (
          <DropdownMenuItem key={site.label} asChild className="cursor-pointer rounded-md p-0 focus:bg-[#F4F7FB]">
            <Link href={site.href} className="flex w-full items-center gap-3 px-3 py-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-md border border-[#D7DCE3] bg-[#F8F6F1]">
                <site.icon className="h-4 w-4 text-[#2764D9]" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-bold text-[#172033]">
                  {site.label}
                  {site.active ? (
                    <span className="rounded-md bg-[#FFF3D8] px-1.5 py-0.5 text-[10px] font-bold text-[#7A5518]">
                      현재
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-[#68707C]">{site.description}</span>
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
