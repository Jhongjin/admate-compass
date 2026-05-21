"use client";

import Link from "next/link";
import { ChevronDown, Compass, Home, LineChart, Radar, ScanLine, ShieldCheck, UserPlus } from "lucide-react";
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
    description: "필요한 제품 이용 권한 요청",
    href: "https://home.admate.ai.kr/access-request?product=compass",
    icon: UserPlus,
    active: false,
  },
  {
    label: "Compass",
    description: "정책 출처 비교와 확인",
    href: "https://compass.admate.ai.kr",
    icon: Compass,
    active: true,
  },
  {
    label: "Sentinel",
    description: "실시간 모니터링과 사전 확인",
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
          aria-label="서비스 이동"
          className="inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-[8px] border border-[#D8DCCF] bg-white/90 px-3 text-sm font-semibold text-[#34423A] shadow-[0_8px_20px_rgba(17,23,19,0.07)] transition duration-200 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:border-[#BFC7BA] hover:bg-[#F7FAF6] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A4D] focus-visible:ring-offset-2 sm:min-w-[126px] sm:px-3.5"
        >
          <ShieldCheck className="h-4 w-4 text-[#1F7A4D]" aria-hidden="true" />
          <span className="hidden sm:inline">서비스 이동</span>
          <ChevronDown className="h-4 w-4 text-[#667066]" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[344px] max-w-[calc(100vw-1rem)] rounded-[10px] border-[#D8DCCF] bg-white p-2 text-[#111713] shadow-[0_20px_52px_rgba(17,23,19,0.16)]"
      >
        <DropdownMenuLabel className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#667066]">
          ADMATE SERVICES
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="mb-1 bg-[#D8DCCF]" />
        {sites.map((site) => (
          <DropdownMenuItem key={site.label} asChild className="cursor-pointer rounded-[8px] p-0 focus:bg-[#F4F8F5]">
            <Link
              href={site.href}
              className="grid min-h-[54px] w-full grid-cols-[38px_minmax(0,1fr)] items-center gap-2.5 px-2.5 py-2"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-[#D8DCCF] bg-[#F4F8F5]">
                <site.icon className="h-[18px] w-[18px] text-[#1F7A4D]" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2 text-sm font-extrabold leading-tight text-[#111713]">
                  {site.label}
                  {site.active ? (
                    <span className="shrink-0 rounded-[7px] bg-[#E6F3E9] px-1.5 py-0.5 text-[10px] font-bold text-[#1F7A4D]">
                      현재
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-xs font-medium leading-5 text-[#667066]">{site.description}</span>
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
