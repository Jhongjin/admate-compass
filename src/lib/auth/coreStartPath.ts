import { sanitizeCompassNextPath } from "@/lib/auth/safeNext";

export function buildCompassCoreAuthStartPath(next?: unknown) {
  const safeNext = sanitizeCompassNextPath(next);
  return `/auth/start?next=${encodeURIComponent(safeNext)}`;
}

export function getCompassCoreProductLoginAction() {
  return process.env.NEXT_PUBLIC_ADMATE_CORE_PRODUCT_LOGIN_URL ||
    "https://sentinel.admate.ai.kr/auth/product/login";
}
