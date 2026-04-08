
import { createPureClient } from '@/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function inspectDocuments() {
    const supabase = await createPureClient();

    console.log('🔍 [InspectDocs] Checking documents table for Naver failures...');

    const { data: docs, error } = await supabase
        .from('documents')
        .select('*')
        .eq('status', 'failed')
        .limit(5);

    if (error) {
        console.error('❌ Error fetching documents:', error);
        return;
    }

    if (!docs || docs.length === 0) {
        console.log('⚠️ No documents with status "failed" found.');

        // Try without status filter to see what's there
        const { data: allDocs } = await supabase.from('documents').select('status, source_vendor').limit(10);
        console.log('📝 Sample rows (status, source_vendor):', allDocs);
        return;
    }

    console.log(`✅ Found ${docs.length} failed documents. Sample:`);
    docs.forEach((doc, i) => {
        console.log(`[${i}] ID: ${doc.id}, Vendor: ${doc.source_vendor}, URL: ${doc.url}`);
    });
}

inspectDocuments().catch(console.error);
