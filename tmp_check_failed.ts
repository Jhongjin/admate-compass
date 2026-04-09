
import { createPureClient } from './src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkFailedDocs() {
    const supabase = await createPureClient();

    console.log('🔍 [Check] Failed documents with 0 chunk_count 조회 중...');

    const { data, error, count } = await supabase
        .from('documents')
        .select('url, title, source_vendor, status, chunk_count', { count: 'exact' })
        .eq('status', 'failed')
        .eq('chunk_count', 0);

    if (error) {
        console.error('❌ Error fetching documents:', error);
        return;
    }

    console.log(`📊 대상 문서 수: ${count}개`);
    if (data && data.length > 0) {
        console.log('📝 샘플 대상 (최대 5개):');
        data.slice(0, 5).forEach(doc => {
            console.log(`- [${doc.source_vendor}] ${doc.url} (${doc.title})`);
        });
    }
}

checkFailedDocs().catch(console.error);
