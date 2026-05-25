import { NextRequest, NextResponse } from "next/server";
import { clearCompassProductSessionCookie } from "@/lib/auth/coreHandoff";

export const dynamic = "force-dynamic";

const DEFAULT_LOGOUT_REDIRECT = "/login?logout=complete";

const ALLOWED_ABSOLUTE_HOSTS = new Set([
  "compass.admate.ai.kr",
  "lens.admate.ai.kr",
  "foresight.admate.ai.kr",
  "sentinel.admate.ai.kr",
  "home.admate.ai.kr",
]);

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "Referrer-Policy": "no-referrer",
  Vary: "Cookie",
};

function isSafeRelativePath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}

function resolveLogoutRedirect(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next")?.trim();

  if (!next || next.includes("\\")) {
    return new URL(DEFAULT_LOGOUT_REDIRECT, request.nextUrl.origin);
  }

  if (isSafeRelativePath(next)) {
    return new URL(next, request.nextUrl.origin);
  }

  try {
    const url = new URL(next);
    if (url.protocol === "https:" && ALLOWED_ABSOLUTE_HOSTS.has(url.host)) {
      return url;
    }
  } catch {
    // Fall through to the default logout target.
  }

  return new URL(DEFAULT_LOGOUT_REDIRECT, request.nextUrl.origin);
}

export function GET(request: NextRequest) {
  const response = NextResponse.redirect(resolveLogoutRedirect(request), {
    status: 302,
    headers: NO_STORE_HEADERS,
  });

  clearCompassProductSessionCookie(response, request.url);
  return response;
}
