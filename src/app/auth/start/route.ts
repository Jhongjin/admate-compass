import { NextRequest, NextResponse } from "next/server";
import {
  buildCoreAuthStartUrl,
  CORE_HANDOFF_NEXT_COOKIE,
  CoreHandoffError,
  getCompassOrigin,
  getCoreHandoffCookieOptions,
} from "@/lib/auth/coreHandoff";
import { sanitizeCompassNextPath } from "@/lib/auth/safeNext";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestUrl = request.url;
  const url = new URL(requestUrl);
  const safeNext = sanitizeCompassNextPath(url.searchParams.get("next"));

  try {
    const startUrl = buildCoreAuthStartUrl({ next: safeNext });
    const response = NextResponse.redirect(startUrl);

    response.cookies.set(
      CORE_HANDOFF_NEXT_COOKIE,
      safeNext,
      getCoreHandoffCookieOptions(requestUrl),
    );

    return response;
  } catch (error) {
    if (error instanceof CoreHandoffError) {
      return redirectToLocalLogin(requestUrl, safeNext, error.reason);
    }

    return redirectToLocalLogin(requestUrl, safeNext, "core_start_failed");
  }
}

function redirectToLocalLogin(requestUrl: string, next: string, reason: string) {
  const loginUrl = new URL("/", getCompassOrigin(requestUrl));
  loginUrl.searchParams.set("next", sanitizeCompassNextPath(next));
  loginUrl.searchParams.set("login_error", reason);

  return NextResponse.redirect(loginUrl);
}
