
import { createPureClient } from '../src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

async function checkCounts() {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
    const supabase = await createPureClient();

    // 1. Documents 테이블 건수 (Vendor별)
    const { data: docs, error: docError } = await supabase
        .from('documents')
        .select('source_vendor, status');

    if (docError) {
        console.error('❌ Documents fetch error:', docError);
    } else {
        const docCounts: Record<string, number> = {};
        const docStatus: Record<string, number> = {};
        docs.forEach(doc => {
            docCounts[doc.source_vendor || 'unknown'] = (docCounts[doc.source_vendor || 'unknown'] || 0) + 1;
            docStatus[doc.status || 'unknown'] = (docStatus[doc.status || 'unknown'] || 0) + 1;
        });
        console.log('📊 Documents by Vendor:', docCounts);
        console.log('📊 Documents by Status:', docStatus);
    }

    // 2. Processing Jobs 테이블 건수 (전체 및 Naver)
    const { data: jobs, error: jobError } = await supabase
        .from('processing_jobs')
        .select('status, payload');

    if (jobError) {
        console.error('❌ Jobs fetch error:', jobError);
    } else {
        const totalJobCount = jobs.length;
        const naverJobCount = jobs.filter(j => j.payload?.vendor === 'NAVER').length;
        const jobStatus: Record<string, number> = {};
        jobs.forEach(j => {
            jobStatus[j.status] = (jobStatus[j.status] || 0) + 1;
        });
        console.log('📋 Total Jobs:', totalJobCount);
        console.log('📋 Naver Jobs (by payload):', naverJobCount);
        console.log('📋 Jobs by Status:', jobStatus);
    }
}

checkCounts().catch(console.error);
