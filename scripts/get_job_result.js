const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getJobResult() {
    const jobId = process.argv[2] || '49e241e1-0295-4a5e-af77-ba93b1bf74ec';
    console.log('Fetching job result for:', jobId);

    const { data, error } = await supabase
        .from('processing_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('--- Job Details ---');
    console.log('Status:', data.status);
    console.log('Error Field:', data.error);
    console.log('Result:', JSON.stringify(data.result, null, 2));
}

getJobResult();
