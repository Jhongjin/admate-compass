const ALLOWED_COMPASS_NEXT_PATHS = new Set(["/", "/chat-ollama", "/history"]);
const SENSITIVE_QUERY_KEY_PATTERN =
  /^(?:token|access_token|refresh_token|id_token|api_key|apikey|secret|password|code)$/i;

const COMPASS_NEXT_BASE_URL = "https://compass.admate.ai.kr";

export function sanitizeCompassNextPath(value: unknown): string {
  if (typeof value !== "string") {
    return "/";
  }

  const next = value.trim().slice(0, 500);

  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\") ||
    /^javascript:/i.test(next)
  ) {
    return "/";
  }

  let parsed: URL;

  try {
    parsed = new URL(next, COMPASS_NEXT_BASE_URL);
  } catch {
    return "/";
  }

  if (parsed.origin !== COMPASS_NEXT_BASE_URL) {
    return "/";
  }

  if (parsed.pathname === "/api" || parsed.pathname.startsWith("/api/")) {
    return "/";
  }

  if (!ALLOWED_COMPASS_NEXT_PATHS.has(parsed.pathname)) {
    return "/";
  }

  const safeSearchParams = new URLSearchParams();

  parsed.searchParams.forEach((paramValue, key) => {
    if (!SENSITIVE_QUERY_KEY_PATTERN.test(key)) {
      safeSearchParams.append(key, paramValue.slice(0, 1000));
    }
  });

  const query = safeSearchParams.toString();
  return query ? `${parsed.pathname}?${query}` : parsed.pathname;
}
