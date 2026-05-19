"use client";

import Link from "next/link";
import { motion } from "framer-motion";
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
  logoClassName = "h-12 w-auto sm:h-14",
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
        "fixed left-0 right-0 top-0 z-50 border-b border-[#D8DCCF] bg-[#FBFBF7]/95 text-[#172033] backdrop-blur-md",
        className,
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={leftHref} className="block shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2764D9] focus-visible:ring-offset-2" aria-label="AdMate Compass 홈">
            <motion.img
              src="/brand/admate-compass-lockup.svg"
              alt="AdMate Compass"
              className={logoClassName}
              whileHover={{
                filter: "brightness(1.02) drop-shadow(0 3px 8px rgba(39, 100, 217, 0.16))",
                transition: { duration: 0.2 },
              }}
            />
          </Link>
          {title ? (
            <div className="hidden min-w-0 md:block">
              <p className="truncate text-sm font-bold text-[#172033]">{title}</p>
              {subtitle ? <p className="truncate text-xs text-[#68707C]">{subtitle}</p> : null}
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
