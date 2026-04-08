
import { createPureClient } from '@/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function deepInspectDocs() {
    const supabase = await createPureClient();

    console.log('🔍 [DeepInspect] Fetching 50 Naver documents to see EXACT statuses...');

    const { data: docs, error } = await supabase
        .from('documents')
        .select('id, status, source_vendor, url')
        .eq('source_vendor', 'NAVER')
        .limit(50);

    if (error) {
        console.error('❌ Error:', error);
        return;
    }

    console.log(`📊 Total docs fetched: ${docs?.length || 0}`);
    docs?.forEach((doc, i) => {
        console.log(`[${i}] ID: ${doc.id} | Status: "${doc.status}" | URL: ${doc.url}`);
    });
}

deepInspectDocs().catch(console.error);
