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
          className="inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-[8px] border border-[#D7DCE3] bg-white/88 px-3 text-sm font-semibold text-[#293B5A] shadow-[0_10px_24px_rgba(23,32,51,0.08)] transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:border-[#C4CEDA] hover:bg-[#F8F6F1] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2764D9] focus-visible:ring-offset-2 sm:min-w-[132px] sm:px-4"
        >
          <Sparkles className="h-4 w-4 text-[#A67B2D]" aria-hidden="true" />
          <span className="hidden sm:inline">사이트 이동</span>
          <ChevronDown className="h-4 w-4 text-[#68707C]" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[400px] max-w-[calc(100vw-1.5rem)] rounded-[10px] border-[#D7DCE3] bg-white p-2.5 text-[#172033] shadow-[0_24px_70px_rgba(16,24,32,0.18)]"
      >
        <DropdownMenuLabel className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#68707C]">
          ADMATE SUITE
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="mb-1.5 bg-[#D8DEE6]" />
        {sites.map((site) => (
          <DropdownMenuItem key={site.label} asChild className="cursor-pointer rounded-[8px] p-0 focus:bg-[#F4F7FB]">
            <Link
              href={site.href}
              className="grid min-h-[64px] w-full grid-cols-[46px_minmax(0,1fr)] items-center gap-3 px-3 py-2.5"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[8px] border border-[#D7DCE3] bg-[#F8F6F1]">
                <site.icon className="h-5 w-5 text-[#2764D9]" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2 text-[15px] font-extrabold leading-tight text-[#172033]">
                  {site.label}
                  {site.active ? (
                    <span className="shrink-0 rounded-[7px] bg-[#FFF3D8] px-1.5 py-0.5 text-[10px] font-bold text-[#7A5518]">
                      현재
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[13px] font-medium leading-5 text-[#68707C]">{site.description}</span>
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
