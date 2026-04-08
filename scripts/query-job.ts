
import { createPureClient } from '@/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function queryJobByDocId() {
    const supabase = await createPureClient();
    const docId = 'doc_1774317580477_h0ebv8s';

    console.log(`🔍 [QueryJob] Fetching job for doc_id: ${docId}`);

    const { data, error } = await supabase
        .from('processing_jobs')
        .select('*')
        .eq('document_id', docId)
        .single();

    if (error) {
        console.error('❌ Error:', error);
        return;
    }

    console.log('✅ Found job:', JSON.stringify(data, null, 2));
}

queryJobByDocId().catch(console.error);
