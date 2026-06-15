import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { readCompassProductSessionFromRequest } from "@/lib/auth/coreHandoff";

export type CompassApiOwner = {
  ownerSubject: string;
  source: "product-session" | "supabase-auth" | "request-user-id";
};

function canUseRequestUserFallback() {
  return process.env.COMPASS_API_ALLOW_REQUEST_USER_FALLBACK === "true" || process.env.NODE_ENV !== "production";
}

async function readSupabaseAuthOwner(request: NextRequest): Promise<CompassApiOwner | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    });
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user?.id) {
      return null;
    }

    return {
      ownerSubject: data.user.id,
      source: "supabase-auth",
    };
  } catch (error) {
    console.warn("Compass API Supabase auth owner 확인 실패:", error);
    return null;
  }
}

export async function resolveCompassApiOwner(
  request: NextRequest,
  fallbackUserId?: unknown
): Promise<CompassApiOwner | null> {
  const productSession = readCompassProductSessionFromRequest(request);
  const subject = productSession?.subject?.trim();

  if (subject) {
    return {
      ownerSubject: subject,
      source: "product-session",
    };
  }

  const supabaseOwner = await readSupabaseAuthOwner(request);
  if (supabaseOwner) {
    return supabaseOwner;
  }

  if (canUseRequestUserFallback() && typeof fallbackUserId === "string" && fallbackUserId.trim()) {
    return {
      ownerSubject: fallbackUserId.trim(),
      source: "request-user-id",
    };
  }

  return null;
}
