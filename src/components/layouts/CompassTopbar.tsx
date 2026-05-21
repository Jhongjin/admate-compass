"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { UserProfileDropdown } from "./UserProfileDropdown";
import { SiteSwitchDropdown } from "./SiteSwitchDropdown";

interface CompassTopbarProps {
  className?: string;
  logoClassName?: string;
  leftHref?: string;
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function CompassTopbar({
  className,
  logoClassName = "h-9 w-9",
  leftHref = "/",
  title,
  subtitle,
  children,
}: CompassTopbarProps) {
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <header
      className={cn(
        "fixed left-0 right-0 top-0 z-50 border-b border-[#D8DCCF] bg-[#FBFBF7]/95 text-[#111713] backdrop-blur-md",
        className,
      )}
    >
      <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-2 px-4 py-2 sm:min-h-16 sm:gap-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={leftHref} className="block shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A4D] focus-visible:ring-offset-2" aria-label="AdMate Compass 홈">
            <span
              aria-hidden="true"
              className={cn("block shrink-0 rounded-md bg-cover bg-center", logoClassName)}
              style={{ backgroundImage: "url('/brand/admate-compass-mark.svg')" }}
            />
          </Link>
          <div className="min-w-0">
            <span className="block truncate text-lg font-bold leading-5 text-[#111713]">AdMate Compass</span>
            <span className="hidden text-[10px] font-semibold uppercase leading-3 tracking-[0.16em] text-[#667066] sm:block">
              정책 출처 확인
            </span>
          </div>
          {title ? (
            <div className="hidden min-w-0 border-l border-[#D8DCCF] pl-3 md:block">
              <p className="truncate text-sm font-bold text-[#111713]">{title}</p>
              {subtitle ? <p className="truncate text-xs text-[#667066]">{subtitle}</p> : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {children}
          <SiteSwitchDropdown />
          <UserProfileDropdown user={user} onSignOut={handleSignOut} />
        </div>
      </div>
    </header>
  );
}
