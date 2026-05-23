import { NextRequest, NextResponse } from "next/server";
import { clearCompassProductSessionCookie } from "@/lib/auth/coreHandoff";

export const dynamic = "force-dynamic";

export function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  clearCompassProductSessionCookie(response, request.url);
  return response;
}
