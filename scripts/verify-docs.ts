
import { createPureClient } from '@/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
    const supabase = await createPureClient();

    console.log('--- Document Status ---');
    const { data: docs, error: dError } = await supabase
        .from('documents')
        .select('id, status, source_vendor, title')
        .eq('source_vendor', 'NAVER')
        .limit(10);

    if (dError) {
        console.error('❌ Document Query Error:', dError);
        return;
    }

    console.log(`Found ${docs?.length} Naver documents.`);
    docs?.forEach(doc => {
        console.log(`- Doc ${doc.id}: status=${doc.status}, title=${doc.title}`);
    });

    const { count: indexedCount } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .eq('source_vendor', 'NAVER')
        .eq('status', 'indexed');

    console.log(`\n✅ Total Indexed Naver Documents: ${indexedCount || 0}`);
}

main().catch(console.error);
