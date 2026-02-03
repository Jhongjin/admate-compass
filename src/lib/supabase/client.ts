import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // 환경 변수가 없을 때 더미 클라이언트 반환
    console.warn('Supabase 환경 변수가 설정되지 않았습니다. 더미 클라이언트를 사용합니다.');
    return createBrowserClient('https://dummy.supabase.co', 'dummy-key');
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
