const DEFAULT_COMPASS_NEXT_PATH = "/desk";
const LEGACY_COMPASS_DESK_PATH = "/chat-ollama";
const ALLOWED_COMPASS_NEXT_PATHS = new Set(["/", "/desk", LEGACY_COMPASS_DESK_PATH, "/history"]);
const SENSITIVE_QUERY_KEY_PATTERN =
  /^(?:token|access_token|refresh_token|id_token|api_key|apikey|secret|password|code)$/i;

const COMPASS_NEXT_BASE_URL = "https://compass.admate.ai.kr";

export function sanitizeCompassNextPath(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_COMPASS_NEXT_PATH;
  }

  const next = value.trim().slice(0, 500);

  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\") ||
    /^javascript:/i.test(next)
  ) {
    return DEFAULT_COMPASS_NEXT_PATH;
  }

  let parsed: URL;

  try {
    parsed = new URL(next, COMPASS_NEXT_BASE_URL);
  } catch {
    return DEFAULT_COMPASS_NEXT_PATH;
  }

  if (parsed.origin !== COMPASS_NEXT_BASE_URL) {
    return DEFAULT_COMPASS_NEXT_PATH;
  }

  if (parsed.pathname === "/api" || parsed.pathname.startsWith("/api/")) {
    return DEFAULT_COMPASS_NEXT_PATH;
  }

  if (!ALLOWED_COMPASS_NEXT_PATHS.has(parsed.pathname)) {
    return DEFAULT_COMPASS_NEXT_PATH;
  }

  const safeSearchParams = new URLSearchParams();

  parsed.searchParams.forEach((paramValue, key) => {
    if (!SENSITIVE_QUERY_KEY_PATTERN.test(key)) {
      safeSearchParams.append(key, paramValue.slice(0, 1000));
    }
  });

  const query = safeSearchParams.toString();
  const pathname =
    parsed.pathname === LEGACY_COMPASS_DESK_PATH ? DEFAULT_COMPASS_NEXT_PATH : parsed.pathname;

  return query ? `${pathname}?${query}` : pathname;
}
