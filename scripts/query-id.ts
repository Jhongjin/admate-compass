
import { createPureClient } from '@/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function querySpecificDoc() {
    const supabase = await createPureClient();
    const targetId = 'doc_1774317580477_h0ebv8s';

    console.log(`🔍 [QueryID] Fetching exact data for: ${targetId}`);

    const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('id', targetId)
        .single();

    if (error) {
        console.error('❌ Error:', error);
        return;
    }

    console.log('✅ Found document:', JSON.stringify(data, null, 2));
}

querySpecificDoc().catch(console.error);
