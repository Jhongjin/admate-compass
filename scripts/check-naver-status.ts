
import { createPureClient } from '../src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkNaverStatus() {
    console.log('🔍 [CheckStatus] 네이버 문서 인덱싱 상태 확인 중...');
    const supabase = await createPureClient();

    const { data, error } = await supabase
        .from('documents')
        .select('id, url, status, chunk_count')
        .eq('source_vendor', 'NAVER')
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('❌ 조회 실패:', error);
        return;
    }

    const stats = data.reduce((acc: any, doc: any) => {
        acc[doc.status] = (acc[doc.status] || 0) + 1;
        if (doc.status === 'indexed' && doc.chunk_count > 0) {
            acc.success_with_chunks = (acc.success_with_chunks || 0) + 1;
        }
        if (doc.status === 'failed' && doc.chunk_count === 0) {
            acc.failed_empty = (acc.failed_empty || 0) + 1;
        }
        return acc;
    }, {});

    console.log('📊 NAVER Documents Stats:', stats);

    if (data.length > 0) {
        console.log('📝 최근 업데이트된 문서 일부:');
        data.slice(0, 5).forEach(doc => {
            console.log(`- [${doc.status}] Chunks: ${doc.chunk_count} | URL: ${doc.url}`);
        });
    }
}

checkNaverStatus().catch(console.error);
