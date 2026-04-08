import { createClient } from '@supabase/supabase-js';

/**
 * Next.js 종속성(cookies, server-only)이 없는 순수 Supabase 클라이언트 생성
 * Node.js 스크립트 및 백그라운드 작업에서 사용 가능
 */
export async function createPureClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        if (process.env.NODE_ENV !== 'production') {
            console.warn('⚠️ Supabase 환경 변수가 설정되지 않았습니다. (URL/KEY 누락)');
        }
        // 더미 클라이언트로 폴백하거나 에러를 던질 수 있음
        // 여기서는 명시적인 에러 처리를 위해 null 체크 대신 빈 클라이언트 반환 (호환성 유지)
        return createClient(supabaseUrl || 'https://dummy.supabase.co', supabaseKey || 'dummy-key');
    }

    return createClient(supabaseUrl, supabaseKey);
}
