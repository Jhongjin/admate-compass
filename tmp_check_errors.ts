
import { createPureClient } from './src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkDocErrors() {
    const supabase = await createPureClient();

    console.log('🔍 [ErrorCheck] Failed documents의 error 메시지 확인 중...');

    const { data, error } = await supabase
        .from('documents')
        .select('url, status, error, chunk_count, updated_at')
        .eq('status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('❌ 조회 실패:', error);
        return;
    }

    console.log('📝 최근 실패 문서 에러 로그:');
    data.forEach(doc => {
        console.log(`- URL: ${doc.url}`);
        console.log(`  Error: ${doc.error}`);
        console.log(`  UpdatedAt: ${doc.updated_at}`);
    });
}

checkDocErrors().catch(console.error);
