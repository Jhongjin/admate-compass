const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function forceReindexFailedKakao() {
    console.log('🔍 Identifying failed KAKAO jobs in processing_jobs...');

    // Find jobs that are failed and belong to KAKAO
    const { data: failedJobs, error: fetchError } = await supabase
        .from('processing_jobs')
        .select('id, payload')
        .eq('job_type', 'CRAWL_SEED')
        .eq('status', 'failed')
        .contains('payload', { vendors: ['KAKAO'] });

    if (fetchError) {
        console.error('❌ Error fetching failed jobs:', fetchError);
        return;
    }

    if (!failedJobs || failedJobs.length === 0) {
        console.log('✅ No failed KAKAO jobs found in the queue.');
        return;
    }

    console.log(`📊 Found ${failedJobs.length} failed jobs. Resetting to 'queued'...`);

    const jobIds = failedJobs.map(j => j.id);

    // Directly update the status to 'queued' to bypass enqueue logic
    const { error: updateError } = await supabase
        .from('processing_jobs')
        .update({
            status: 'queued',
            attempts: 0,
            error: null,
            updated_at: new Date().toISOString()
        })
        .in('id', jobIds);

    if (updateError) {
        console.error('❌ Error updating jobs:', updateError);
    } else {
        console.log(`✅ Successfully reset ${jobIds.length} jobs to 'queued'.`);
        console.log('🚀 Triggering worker to start processing...');

        // Optional: Trigger worker via curl/axios if needed
        // But usually the system has a cron or active workers
    }
}

forceReindexFailedKakao();
