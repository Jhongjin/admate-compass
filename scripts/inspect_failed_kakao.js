const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectFailedJobs() {
    console.log('🔍 Inspecting failed KAKAO jobs...');

    const { data: jobs, error } = await supabase
        .from('processing_jobs')
        .select('*')
        .eq('job_type', 'CRAWL_SEED')
        .eq('status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('❌ Error fetching jobs:', error);
        return;
    }

    const kakaoFailed = jobs?.filter(job => {
        const payload = job.payload;
        return payload && payload.vendors && payload.vendors.includes('KAKAO');
    }) || [];

    if (kakaoFailed.length === 0) {
        console.log('⚠️ No recently failed KAKAO jobs (type CRAWL_SEED) found in the last 10 entries.');
        // Try searching by payload directly
        const { data: allFailed, error: error2 } = await supabase
            .from('processing_jobs')
            .select('*')
            .eq('status', 'failed')
            .order('updated_at', { ascending: false })
            .limit(50);

        const kakaoAllFailed = allFailed?.filter(job => {
            const payload = job.payload;
            return payload && (payload.vendors?.includes('KAKAO') || payload.vendor === 'KAKAO');
        }) || [];

        if (kakaoAllFailed.length > 0) {
            console.log(`✅ Found ${kakaoAllFailed.length} failed KAKAO jobs.`);
            kakaoAllFailed.slice(0, 3).forEach(job => {
                console.log(`\nID: ${job.id}`);
                console.log(`URL: ${job.payload.url}`);
                console.log(`Error: ${job.last_error || job.error || 'No error message'}`);
                console.log(`Payload: ${JSON.stringify(job.payload)}`);
            });
        }
    } else {
        kakaoFailed.forEach(job => {
            console.log(`\nID: ${job.id}`);
            console.log(`URL: ${job.payload.url}`);
            console.log(`Error: ${job.last_error || job.error || 'No error message'}`);
        });
    }
}

inspectFailedJobs().catch(console.error);
