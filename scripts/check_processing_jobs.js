const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkJobs() {
    const { data, error } = await supabase
        .from('processing_jobs')
        .select('id, status, job_type, updated_at, payload')
        .eq('status', 'processing');

    if (error) {
        console.error(error);
        return;
    }

    const now = new Date();
    data.forEach(j => {
        const diff = (now - new Date(j.updated_at)) / 1000 / 60;
        console.log(`Job ${j.id} (${j.job_type}): ${diff.toFixed(2)} minutes old | URL: ${j.payload?.url}`);
    });

    if (data.length === 0) {
        console.log('No jobs currently in processing state.');
    }
}

checkJobs();
