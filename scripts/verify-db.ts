
import { createPureClient } from '@/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
    const supabase = await createPureClient();

    console.log('Checking database connection and jobs...');

    const { count, error } = await supabase
        .from('processing_jobs')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('❌ Connection or Query Error:', error);
        return;
    }

    console.log(`✅ Total jobs in processing_jobs: ${count}`);

    const { data: naverJobs, error: nError } = await supabase
        .from('processing_jobs')
        .select('id, status, job_type, payload')
        .eq('job_type', 'CRAWL')
        .limit(5);

    if (nError) {
        console.error('❌ Naver Query Error:', nError);
        return;
    }

    console.log(`✅ Sample Naver jobs count: ${naverJobs?.length}`);
    naverJobs?.forEach(j => {
        console.log(`- Job ${j.id}: status=${j.status}, vendor=${(j.payload as any)?.vendor}`);
    });
}

main().catch(console.error);
