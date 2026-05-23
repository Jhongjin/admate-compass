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
    product: "compass",
    directHref: "https://compass.admate.ai.kr",
    handoffHref: "https://sentinel.admate.ai.kr/auth/product/start?product=compass&next=/",
    icon: Compass,
    active: true,
  },
  {
    label: "Sentinel",
    description: "실시간 모니터링과 사전 확인",
    directHref: "https://sentinel.admate.ai.kr",
    icon: Radar,
    active: false,
  },
  {
    label: "Lens",
    description: "캡처 검수와 작업 기록",
    product: "lens",
    directHref: "https://lens.admate.ai.kr",
    handoffHref: "https://sentinel.admate.ai.kr/auth/product/start?product=lens&next=/",
    icon: ScanLine,
    active: false,
  },
  {
    label: "Foresight",
    description: "성과 예측과 기준선 관리",
    product: "foresight",
    directHref: "https://foresight.admate.ai.kr",
    handoffHref: "https://sentinel.admate.ai.kr/auth/product/start?product=foresight&next=/",
    icon: LineChart,
    active: false,
  },
] as const;

export function SiteSwitchDropdown({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="사이트 이동"
          className="inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-[8px] border border-[#D7DCE3] bg-white/90 px-3 text-sm font-semibold text-[#25314A] shadow-[0_10px_24px_rgba(16,24,32,0.08)] transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:border-[#C4CEDA] hover:bg-[#F8F6F1] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#172033] focus-visible:ring-offset-2 sm:min-w-[132px] sm:px-4"
        >
          <ShieldCheck className="h-4 w-4 text-[#177D4E]" aria-hidden="true" />
          <span className="hidden sm:inline">사이트 이동</span>
          <ChevronDown className="h-4 w-4 text-[#177D4E]" aria-hidden="true" />
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
        {sites.map((site) => {
          const href = "handoffHref" in site && isAuthenticated
            ? site.handoffHref
            : "directHref" in site
              ? site.directHref
              : site.href;

          return (
          <DropdownMenuItem key={site.label} asChild className="cursor-pointer rounded-[8px] p-0 focus:bg-[#F4F8F5]">
            <Link
              href={href}
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
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
