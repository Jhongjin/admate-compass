import { sanitizeCompassNextPath } from "@/lib/auth/safeNext";

export function buildCompassCoreAuthStartPath(next?: unknown) {
  const safeNext = sanitizeCompassNextPath(next);
  return `/auth/start?next=${encodeURIComponent(safeNext)}`;
}
