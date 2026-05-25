import { NextRequest, NextResponse } from "next/server";
import { clearCompassProductSessionCookie } from "@/lib/auth/coreHandoff";

export const dynamic = "force-dynamic";

const DEFAULT_LOGOUT_REDIRECT = "/";

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

const LOGIN_ERROR_PATTERN = /^[a-z0-9_-]+$/i;

function isSafeRelativePath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}

function normalizeLegacyLoginRedirect(url: URL) {
  if (url.pathname !== "/login") {
    return url;
  }

  const normalized = new URL("/", url.origin);
  const next = url.searchParams.get("next");
  const loginError = url.searchParams.get("login_error") || url.searchParams.get("auth_error");

  if (next && isSafeRelativePath(next) && !next.startsWith("/api")) {
    normalized.searchParams.set("next", next);
  }

  if (loginError && LOGIN_ERROR_PATTERN.test(loginError)) {
    normalized.searchParams.set("login_error", loginError);
  }

  return normalized;
}

function resolveLogoutRedirect(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next")?.trim();

  if (!next || next.includes("\\")) {
    return new URL(DEFAULT_LOGOUT_REDIRECT, request.nextUrl.origin);
  }

  if (isSafeRelativePath(next)) {
    return normalizeLegacyLoginRedirect(new URL(next, request.nextUrl.origin));
  }

  try {
    const url = new URL(next);
    if (url.protocol === "https:" && ALLOWED_ABSOLUTE_HOSTS.has(url.host)) {
      return normalizeLegacyLoginRedirect(url);
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
