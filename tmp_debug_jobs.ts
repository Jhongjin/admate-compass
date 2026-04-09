
import { createPureClient } from './src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function debugJobs() {
    const supabase = await createPureClient();
    const { data: jobs } = await supabase.from('processing_jobs').select('*').limit(3);
    console.log('📦 Job Samples:', JSON.stringify(jobs, null, 2));

    const { data: failedCols } = await supabase.from('documents').select('id, status, chunk_count').eq('status', 'pending').limit(5);
    console.log('📝 Pending Doc Samples:', JSON.stringify(failedCols, null, 2));
}

debugJobs().catch(console.error);
