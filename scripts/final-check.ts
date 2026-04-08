
import { createPureClient } from '@/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
    const supabase = await createPureClient();

    console.log('--- Final Status Check ---');

    const { count: totalTasks, error: e1 } = await supabase
        .from('processing_jobs')
        .select('*', { count: 'exact', head: true })
        .eq('job_type', 'CRAWL')
        .eq('payload->>vendor', 'NAVER');

    const { count: completedTasks, error: e2 } = await supabase
        .from('processing_jobs')
        .select('*', { count: 'exact', head: true })
        .eq('job_type', 'CRAWL')
        .eq('payload->>vendor', 'NAVER')
        .eq('status', 'completed');

    const { count: failedTasks, error: e3 } = await supabase
        .from('processing_jobs')
        .select('*', { count: 'exact', head: true })
        .eq('job_type', 'CRAWL')
        .eq('payload->>vendor', 'NAVER')
        .eq('status', 'failed');

    const { count: indexedDocs, error: e4 } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .eq('source_vendor', 'NAVER')
        .eq('status', 'indexed');

    console.log(`Naver Jobs: Total=${totalTasks}, Completed=${completedTasks}, Failed=${failedTasks}`);
    console.log(`Naver Documents: Indexed=${indexedDocs}`);
}

main().catch(console.error);
