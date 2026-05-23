import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeCompassNextPath } from "@/lib/auth/safeNext";

export const COMPASS_AUTH_PRODUCT_ID = "compass";
export const CORE_HANDOFF_NEXT_COOKIE = "admate_compass_handoff_next";
export const COMPASS_PRODUCT_SESSION_COOKIE = "admate_compass_session";

const DEFAULT_CORE_AUTH_START_URL = "https://sentinel.admate.ai.kr/auth/product/start";
const DEFAULT_CORE_HANDOFF_REDEEM_URL = "https://sentinel.admate.ai.kr/api/auth/handoff/redeem";
const DEFAULT_COMPASS_HANDOFF_CALLBACK_URL = "https://compass.admate.ai.kr/auth/handoff";
const CORE_HANDOFF_TIMEOUT_MS = 10000;
const PRODUCT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;
const HANDOFF_CODE_PATTERN = /^[A-Za-z0-9._~:-]{8,2048}$/;

export type CompassProductSession = {
  subject: string;
  expiresAt: number;
  returnPath: string;
  profile: {
    displayName: string;
    email: string;
  };
  rolesLabel: string;
  permissions: {
    canView: boolean;
    canSubmit: boolean;
    canManage: boolean;
  };
  adminNavigation: {
    canManageAccessRequests: boolean;
    canManageOrganizations: boolean;
    canManageUsers: boolean;
  };
};

type HandoffCodeResult =
  | { ok: true; code: string }
  | { ok: false; reason: "missing_code" | "ambiguous_code" | "invalid_code" | "unsafe_callback_query" };

export class CoreHandoffError extends Error {
  constructor(
    public readonly reason:
      | "core_start_url_invalid"
      | "core_redeem_url_invalid"
      | "core_redeem_failed"
      | "core_redeem_timeout"
      | "core_redeem_invalid_response"
      | "core_handoff_secret_missing"
      | "compass_session_secret_missing",
    public readonly status?: number,
  ) {
    super(reason);
    this.name = "CoreHandoffError";
  }
}

export function parseCoreHandoffCode(searchParams: URLSearchParams): HandoffCodeResult {
  for (const key of searchParams.keys()) {
    if (key !== "code") {
      return { ok: false, reason: "unsafe_callback_query" };
    }
  }

  const codes = searchParams.getAll("code");

  if (codes.length === 0) {
    return { ok: false, reason: "missing_code" };
  }

  if (codes.length > 1) {
    return { ok: false, reason: "ambiguous_code" };
  }

  const code = codes[0].trim();

  if (!HANDOFF_CODE_PATTERN.test(code)) {
    return { ok: false, reason: "invalid_code" };
  }

  return { ok: true, code };
}

export function buildCoreAuthStartUrl({
  next,
}: {
  next?: unknown;
}) {
  const startUrl = getConfiguredUrl(
    process.env.ADMATE_CORE_AUTH_START_URL,
    DEFAULT_CORE_AUTH_START_URL,
    "core_start_url_invalid",
  );

  startUrl.searchParams.set("product", COMPASS_AUTH_PRODUCT_ID);
  startUrl.searchParams.set("next", sanitizeCompassNextPath(next));

  return startUrl;
}

export function getCompassHandoffCallbackUrl() {
  return process.env.ADMATE_COMPASS_HANDOFF_CALLBACK_URL?.trim() || DEFAULT_COMPASS_HANDOFF_CALLBACK_URL;
}

export function getCompassOrigin(requestUrl: string) {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;

  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);

      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return parsed.origin;
      }
    } catch {
      // Fall through to the current request origin.
    }
  }

  return new URL(requestUrl).origin;
}

export function getCoreHandoffCookieOptions(requestUrl: string, maxAge = 600) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax" as const,
    secure: new URL(requestUrl).protocol === "https:",
  };
}

export async function redeemCoreHandoffCode({
  code,
  fallbackNext,
}: {
  code: string;
  fallbackNext?: unknown;
}): Promise<CompassProductSession> {
  const redeemUrl = getConfiguredUrl(
    process.env.ADMATE_CORE_HANDOFF_REDEEM_URL,
    DEFAULT_CORE_HANDOFF_REDEEM_URL,
    "core_redeem_url_invalid",
  );
  let response: Response;

  try {
    response = await fetch(redeemUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-admate-product-handoff-key": getCompassHandoffSecret(),
      },
      body: JSON.stringify({
        product_slug: COMPASS_AUTH_PRODUCT_ID,
        code,
        callback_url: getCompassHandoffCallbackUrl(),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(CORE_HANDOFF_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new CoreHandoffError("core_redeem_timeout");
    }

    throw new CoreHandoffError("core_redeem_failed");
  }

  if (!response.ok) {
    throw new CoreHandoffError("core_redeem_failed", response.status);
  }

  const payload: unknown = await response.json().catch(() => null);
  const session = readCompassProductSession(payload, fallbackNext);

  if (!session) {
    throw new CoreHandoffError("core_redeem_invalid_response");
  }

  return session;
}

export function applyCompassProductSessionCookie(
  response: NextResponse,
  session: CompassProductSession,
  requestUrl: string,
) {
  const secret = getCompassSessionSecret(true);
  const payload = encodeBase64Url(JSON.stringify(session));
  const signature = signPayload(payload, secret);
  const secondsUntilExpiry = session.expiresAt - Math.floor(Date.now() / 1000);

  response.cookies.set({
    name: COMPASS_PRODUCT_SESSION_COOKIE,
    value: `${payload}.${signature}`,
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(requestUrl).protocol === "https:",
    path: "/",
    maxAge: Math.max(0, Math.min(secondsUntilExpiry, PRODUCT_SESSION_MAX_AGE_SECONDS)),
  });
}

export function clearCompassProductSessionCookie(response: NextResponse, requestUrl: string) {
  response.cookies.set({
    name: COMPASS_PRODUCT_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(requestUrl).protocol === "https:",
    path: "/",
    maxAge: 0,
  });
}

export function readCompassProductSessionFromRequest(
  request: NextRequest,
): CompassProductSession | null {
  const cookieValue = request.cookies.get(COMPASS_PRODUCT_SESSION_COOKIE)?.value;
  if (!cookieValue) return null;

  const secret = getCompassSessionSecret(false);
  if (!secret) return null;

  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = signPayload(payload, secret);
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as unknown;
    if (!isCompassProductSession(parsed)) return null;
    if (parsed.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return {
      ...parsed,
      adminNavigation: readAdminNavigation(parsed.adminNavigation),
    };
  } catch {
    return null;
  }
}

function getConfiguredUrl(
  configuredValue: string | undefined,
  fallbackValue: string,
  errorReason: "core_start_url_invalid" | "core_redeem_url_invalid",
) {
  const value = configuredValue?.trim() || fallbackValue;

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("unsupported_protocol");
    }

    return url;
  } catch {
    throw new CoreHandoffError(errorReason);
  }
}

function getCompassHandoffSecret() {
  const value =
    process.env.ADMATE_COMPASS_HANDOFF_SECRET?.trim() ||
    process.env.ADMATE_AUTH_HANDOFF_COMPASS_KEY?.trim() ||
    "";

  if (!value) {
    throw new CoreHandoffError("core_handoff_secret_missing");
  }

  return value;
}

function getCompassSessionSecret(required: true): string;
function getCompassSessionSecret(required: false): string | null;
function getCompassSessionSecret(required: boolean) {
  const value =
    process.env.ADMATE_COMPASS_SESSION_SECRET?.trim() ||
    process.env.ADMATE_COMPASS_HANDOFF_SECRET?.trim() ||
    process.env.ADMATE_AUTH_HANDOFF_COMPASS_KEY?.trim() ||
    "";

  if (!value) {
    if (required) {
      throw new CoreHandoffError("compass_session_secret_missing");
    }
    return null;
  }

  return value;
}

function readCompassProductSession(
  payload: unknown,
  fallbackNext: unknown,
): CompassProductSession | null {
  const root = asRecord(payload);
  const profile = asRecord(root?.profile);
  const product = asRecord(root?.product);
  const permissions = asRecord(root?.permissions);
  const session = asRecord(root?.session);
  const subject = readString(root?.subject);
  const email = readString(profile?.email);
  const ttlSeconds = readNumber(session?.ttl_seconds) ?? readNumber(session?.ttlSeconds);

  if (!root?.ok || !subject || !email || !ttlSeconds || ttlSeconds <= 0) {
    return null;
  }

  return {
    subject,
    expiresAt: Math.floor(Date.now() / 1000) + Math.min(ttlSeconds, PRODUCT_SESSION_MAX_AGE_SECONDS),
    returnPath: sanitizeCompassNextPath(
      root.return_path ?? root.returnPath ?? session?.return_path ?? session?.returnPath ?? fallbackNext,
    ),
    profile: {
      displayName:
        readString(profile?.display_name) ||
        readString(profile?.displayName) ||
        readString(profile?.name) ||
        email.split("@")[0] ||
        "Compass 사용자",
      email,
    },
    rolesLabel:
      readString(product?.access_label) ||
      readString(product?.accessLabel) ||
      "Compass 사용 권한",
    permissions: {
      canView: Boolean(permissions?.can_view ?? permissions?.canView),
      canSubmit: Boolean(permissions?.can_submit ?? permissions?.canSubmit),
      canManage: Boolean(permissions?.can_manage ?? permissions?.canManage),
    },
    adminNavigation: readAdminNavigation(root.admin_navigation ?? root.adminNavigation),
  };
}

function isCompassProductSession(value: unknown): value is CompassProductSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const session = value as Partial<CompassProductSession>;
  const profile = session.profile as Partial<CompassProductSession["profile"]> | undefined;
  const permissions = session.permissions as Partial<CompassProductSession["permissions"]> | undefined;

  return (
    typeof session.subject === "string" &&
    session.subject.trim().length > 0 &&
    typeof session.expiresAt === "number" &&
    Number.isFinite(session.expiresAt) &&
    typeof session.returnPath === "string" &&
    typeof profile?.displayName === "string" &&
    typeof profile?.email === "string" &&
    typeof session.rolesLabel === "string" &&
    typeof permissions?.canView === "boolean" &&
    typeof permissions?.canSubmit === "boolean" &&
    typeof permissions?.canManage === "boolean"
  );
}

function readAdminNavigation(value: unknown): CompassProductSession["adminNavigation"] {
  const adminNavigation = asRecord(value);

  return {
    canManageAccessRequests: Boolean(
      adminNavigation?.can_manage_access_requests ?? adminNavigation?.canManageAccessRequests,
    ),
    canManageOrganizations: Boolean(
      adminNavigation?.can_manage_organizations ?? adminNavigation?.canManageOrganizations,
    ),
    canManageUsers: Boolean(adminNavigation?.can_manage_users ?? adminNavigation?.canManageUsers),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
