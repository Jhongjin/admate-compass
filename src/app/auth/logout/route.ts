import { NextRequest, NextResponse } from "next/server";
import { clearCompassProductSessionCookie } from "@/lib/auth/coreHandoff";
import { sanitizeCompassNextPath } from "@/lib/auth/safeNext";

export const dynamic = "force-dynamic";

const DEFAULT_CORE_LOGOUT_URL = "https://sentinel.admate.ai.kr/auth/logout";

const ALLOWED_LOCAL_LOGOUT_NEXT_HOSTS = new Set([
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

function resolveProductRedirect(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next")?.trim();
  return new URL(sanitizeCompassNextPath(next), request.nextUrl.origin);
}

function isSafeLocalProtocol(url: URL) {
  if (process.env.NODE_ENV === "production") {
    return url.protocol === "https:";
  }

  return url.protocol === "https:" || url.protocol === "http:";
}

function isSelfLogoutRedirect(url: URL, request: NextRequest) {
  return url.host === request.nextUrl.host && url.pathname === "/auth/logout";
}

function resolveLocalScopeRedirect(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next")?.trim();
  const fallback = new URL("/", request.nextUrl.origin);

  if (!next || next.includes("\\") || /^javascript:/i.test(next)) {
    return fallback;
  }

  if (next.startsWith("/") && !next.startsWith("//")) {
    return resolveProductRedirect(request);
  }

  try {
    const url = new URL(next);
    if (
      isSafeLocalProtocol(url) &&
      ALLOWED_LOCAL_LOGOUT_NEXT_HOSTS.has(url.host) &&
      !isSelfLogoutRedirect(url, request)
    ) {
      return url;
    }
  } catch {
    // Fall through to the product root.
  }

  return fallback;
}

function getCoreLogoutUrl() {
  const value = process.env.ADMATE_CORE_LOGOUT_URL?.trim() || DEFAULT_CORE_LOGOUT_URL;
  try {
    const url = new URL(value);
    if (isSafeLocalProtocol(url)) return url;
  } catch {
    // Fall through to the default Core logout endpoint.
  }

  return new URL(DEFAULT_CORE_LOGOUT_URL);
}

function resolveLogoutRedirect(request: NextRequest) {
  const productRedirect = resolveProductRedirect(request);

  if (request.nextUrl.searchParams.get("scope") === "local") {
    return resolveLocalScopeRedirect(request);
  }

  const coreLogoutUrl = getCoreLogoutUrl();
  coreLogoutUrl.searchParams.set("next", productRedirect.toString());
  return coreLogoutUrl;
}

export function GET(request: NextRequest) {
  const response = NextResponse.redirect(resolveLogoutRedirect(request), {
    status: 302,
    headers: NO_STORE_HEADERS,
  });

  clearCompassProductSessionCookie(response, request.url);
  return response;
}
