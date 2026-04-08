
import { createPureClient } from '../src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

async function checkExactCounts() {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
    const supabase = await createPureClient();

    // 1. Documents 전체 건수 (count: 'exact' 적용)
    const { count: totalDocs, error: err1 } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true });

    // 2. Naver Documents 건수
    const { count: naverDocs, error: err2 } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .eq('source_vendor', 'NAVER');

    // 3. Naver Jobs 건수 (Payload 내부 검색)
    const { count: naverJobs, error: err3 } = await supabase
        .from('processing_jobs')
        .select('*', { count: 'exact', head: true })
        .contains('payload', { vendor: 'NAVER' });

    console.log({ totalDocs, naverDocs, naverJobs });
}

checkExactCounts().catch(console.error);
