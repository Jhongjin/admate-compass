const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkQueue() {
    const { data: queuedJobs, error } = await supabase
        .from('processing_jobs')
        .select('id, priority, created_at, payload')
        .eq('status', 'queued')
        .order('priority', { ascending: false })
        .order('scheduled_at', { ascending: true });

    if (error) {
        console.error(error);
        return;
    }

    console.log(`\n🔝 Top 10 Queued Jobs:`);
    queuedJobs.slice(0, 10).forEach((j, index) => {
        const url = j.payload?.url || 'N/A';
        console.log(`${index + 1}. [${j.id.substring(0, 8)}] Priority: ${j.priority} | URL: ${url}`);
    });

    const myJobId = '55bce264-1d7c-4702-bd7d-fd7fb45e72f7';
    const myJobIndex = queuedJobs.findIndex(j => j.id === myJobId);

    if (myJobIndex === -1) {
        console.log('Job not found in queued status.');
        const { data: job } = await supabase.from('processing_jobs').select('status').eq('id', myJobId).single();
        console.log('Current status:', job?.status);
    } else {
        console.log(`Job found at position ${myJobIndex + 1} in the queue.`);
        console.log('Jobs ahead:', myJobIndex);
    }
}

checkQueue();
