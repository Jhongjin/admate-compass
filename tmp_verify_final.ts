
import { createPureClient } from './src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function verifyStatus() {
    const supabase = await createPureClient();

    console.log('🔍 [Verify] 최종 상태 확인 중...');

    // 1. documents pending 상태 확인
    const { count: pendingDocs } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

    // 2. processing_jobs queued 상태 확인
    const { count: queuedJobs } = await supabase
        .from('processing_jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'queued');

    console.log(`📊 현재 Pending 문서: ${pendingDocs}개`);
    console.log(`📊 현재 Queued 작업: ${queuedJobs}개`);
}

verifyStatus().catch(console.error);
