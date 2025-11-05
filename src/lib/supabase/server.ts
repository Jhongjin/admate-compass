import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase 환경 변수가 설정되지 않았습니다. 더미 클라이언트를 사용합니다.');
    return createServerClient('https://dummy.supabase.co', 'dummy-key', {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    });
  }

  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
}

export async function createPureClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase 환경 변수가 설정되지 않았습니다. 더미 클라이언트를 사용합니다.');
    return createServerClient('https://dummy.supabase.co', 'dummy-key', {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    });
  }

  // Pro 플랜 최적화: 서버 사이드 연결 풀링 최적화
  // - persistSession: false - 서버 사이드에서는 세션 불필요
  // - autoRefreshToken: false - Service Role Key 사용 시 토큰 갱신 불필요
  // - db.schema: 'public' - 명시적 스키마 지정으로 성능 향상
  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
      {
        auth: {
          persistSession: false, // 서버 사이드에서는 세션 불필요
          autoRefreshToken: false, // Service Role Key 사용 시 토큰 갱신 불필요
        },
        db: {
          schema: 'public', // 명시적 스키마 지정으로 성능 향상
        },
        global: {
          headers: {
            'x-client-info': 'meta-faq-chatbot-server', // 클라이언트 식별
          },
        },
      }
    }
  );
}
