
import { createPureClient } from '@/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkJobs() {
    const supabase = await createPureClient();

    console.log('🔍 [JobCheck] 최근 Naver 관련 작업 10건 확인...');

    const { data, error } = await supabase
        .from('processing_jobs')
        .select('*')
        .contains('payload', { vendor: 'NAVER' })
        .order('updated_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('❌ 작업 조회 실패:', error);
        return;
    }

    if (!data || data.length === 0) {
        console.log('⚠️ Naver 관련 작업이 없습니다.');
        return;
    }

    console.log(`\n📊 최근 작업 ${data.length}건 요약:`);
    data.forEach((job, i) => {
        console.log(`[${i + 1}] ID: ${job.id}`);
        console.log(`   - Status: ${job.status}`);
        console.log(`   - URL: ${job.payload?.url}`);
        console.log(`   - Error: ${job.error ? job.error.substring(0, 50) + '...' : 'None'}`);
        console.log(`   - Updated: ${job.updated_at}`);
        console.log('-------------------');
    });
}

checkJobs().catch(console.error);
