"use client";

const DEFAULT_TIMEOUT_MS = Number(
  process.env.NEXT_PUBLIC_ADMIN_FETCH_TIMEOUT_MS ?? "15000"
);

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export { DEFAULT_TIMEOUT_MS as DEFAULT_ADMIN_FETCH_TIMEOUT_MS };

