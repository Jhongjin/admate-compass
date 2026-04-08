const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Supabase credentials missing in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyKakaoJobs() {
    console.log('📊 Verifying KAKAO jobs in the database (JS version)...');

    const { data: jobs, error } = await supabase
        .from('processing_jobs')
        .select('id, status, payload')
        .eq('job_type', 'CRAWL_SEED')
        .order('created_at', { ascending: false })
        .limit(1000);

    if (error) {
        console.error('❌ Error fetching jobs:', error);
        return;
    }

    const kakaoJobs = jobs?.filter(job => {
        const payload = job.payload;
        return payload && payload.vendors && payload.vendors.includes('KAKAO');
    }) || [];

    console.log(`✅ Found ${kakaoJobs.length} KAKAO jobs in the last 1000 CRAWL_SEED jobs.`);

    if (kakaoJobs.length > 0) {
        const statusStats = kakaoJobs.reduce((acc, job) => {
            acc[job.status] = (acc[job.status] || 0) + 1;
            return acc;
        }, {});

        console.log('\n📈 KAKAO Job Status Stats:');
        Object.entries(statusStats).forEach(([status, count]) => {
            console.log(`- ${status}: ${count} jobs`);
        });

        console.log('\n📅 Latest 20 KAKAO Jobs:');
        kakaoJobs.slice(0, 20).forEach(j => {
            const url = j.payload?.url || 'N/A';
            const shortJobId = j.id.substring(0, 8);
            console.log(`- [${shortJobId}] ${j.status.padEnd(10)} | ${url}`);
        });
    } else {
        console.log('⚠️ No KAKAO jobs found in the last 1000 entries.');
    }
}

verifyKakaoJobs().catch(console.error);
