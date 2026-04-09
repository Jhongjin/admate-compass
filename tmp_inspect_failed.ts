
import { createPureClient } from './src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectFailedDocs() {
    const supabase = await createPureClient();

    console.log('🔍 [Inspect] status=failed 상태 문서 정밀 조사...');

    const { data, error, count } = await supabase
        .from('documents')
        .select('id, url, status, chunk_count, source_vendor', { count: 'exact' })
        .eq('status', 'failed');

    if (error) {
        console.error('❌ 조회 실패:', error);
        return;
    }

    console.log(`📊 전체 failed 문서 수: ${count}개`);
    if (data && data.length > 0) {
        const zeroChunks = data.filter(d => d.chunk_count === 0 || d.chunk_count === null);
        console.log(`📉 chunk_count가 0 또는 NULL인 문서: ${zeroChunks.length}개`);

        console.log('📝 샘플 (최대 10개):');
        zeroChunks.slice(0, 10).forEach(doc => {
            console.log(`- [${doc.source_vendor}] id: ${doc.id}, chunk: ${doc.chunk_count}, url: ${doc.url}`);
        });
    }
}

inspectFailedDocs().catch(console.error);
