import { NextRequest, NextResponse } from "next/server";
import {
  CORE_HANDOFF_NEXT_COOKIE,
  CoreHandoffError,
  applyCompassProductSessionCookie,
  getCompassOrigin,
  getCoreHandoffCookieOptions,
  parseCoreHandoffCode,
  redeemCoreHandoffCode,
} from "@/lib/auth/coreHandoff";
import { sanitizeCompassNextPath } from "@/lib/auth/safeNext";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestUrl = request.url;
  const url = new URL(requestUrl);
  const fallbackNext = sanitizeCompassNextPath(
    request.cookies.get(CORE_HANDOFF_NEXT_COOKIE)?.value,
  );
  const parsedCode = parseCoreHandoffCode(url.searchParams);

  if (!parsedCode.ok) {
    return redirectToLogin(requestUrl, fallbackNext, parsedCode.reason);
  }

  try {
    const redeemed = await redeemCoreHandoffCode({
      code: parsedCode.code,
      fallbackNext,
    });
    const response = NextResponse.redirect(
      new URL(sanitizeCompassNextPath(redeemed.returnPath), getCompassOrigin(requestUrl)),
    );

    applyCompassProductSessionCookie(response, redeemed, requestUrl);
    clearHandoffCookie(response, requestUrl);

    return response;
  } catch (error) {
    const reason = error instanceof CoreHandoffError ? error.reason : "core_redeem_failed";
    const response = redirectToLogin(requestUrl, fallbackNext, reason);

    clearHandoffCookie(response, requestUrl);

    return response;
  }
}

function redirectToLogin(requestUrl: string, next: string, reason: string) {
  const loginUrl = new URL("/", getCompassOrigin(requestUrl));
  loginUrl.searchParams.set("next", sanitizeCompassNextPath(next));
  loginUrl.searchParams.set("login_error", reason);

  return NextResponse.redirect(loginUrl);
}

function clearHandoffCookie(response: NextResponse, requestUrl: string) {
  response.cookies.set(
    CORE_HANDOFF_NEXT_COOKIE,
    "",
    getCoreHandoffCookieOptions(requestUrl, 0),
  );
}
