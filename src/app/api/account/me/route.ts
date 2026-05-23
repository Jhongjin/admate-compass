import { NextRequest, NextResponse } from "next/server";
import { readCompassProductSessionFromRequest } from "@/lib/auth/coreHandoff";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const session = readCompassProductSessionFromRequest(request);

  if (!session) {
    return NextResponse.json(
      {
        ok: false,
        authenticated: false,
        accountStatus: "signed_out",
      },
      { status: 401 },
    );
  }

  return NextResponse.json({
    ok: true,
    authenticated: true,
    accountStatus: "active",
    subject: session.subject,
    profile: session.profile,
    permissions: session.permissions,
    rolesLabel: session.rolesLabel,
  });
}
