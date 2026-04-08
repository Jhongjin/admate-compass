import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyKakaoJobs() {
    console.log('📊 Verifying KAKAO jobs in the database...');

    // Try to find jobs with 'KAKAO' in the vendors array in the payload
    const { data: jobs, error } = await supabase
        .from('processing_jobs')
        .select('id, status, payload')
        .eq('job_type', 'CRAWL_SEED')
        .order('created_at', { ascending: false })
        .limit(500);

    if (error) {
        console.error('❌ Error fetching jobs:', error);
        return;
    }

    const kakaoJobs = jobs?.filter(job => {
        const payload = job.payload as any;
        return payload && payload.vendors && payload.vendors.includes('KAKAO');
    }) || [];

    console.log(`✅ Found ${kakaoJobs.length} KAKAO jobs in the last 500 CRAWL_SEED jobs.`);

    if (kakaoJobs.length > 0) {
        const statusStats = kakaoJobs.reduce((acc: any, job: any) => {
            acc[job.status] = (acc[job.status] || 0) + 1;
            return acc;
        }, {});

        console.log('\n📈 KAKAO Job Status Stats:');
        Object.entries(statusStats).forEach(([status, count]) => {
            console.log(`- ${status}: ${count} jobs`);
        });
    } else {
        console.log('⚠️ No KAKAO jobs found. Checking if vendor field name is different...');
        const otherJobs = jobs?.slice(0, 5).map(j => JSON.stringify(j.payload));
        console.log('Example payloads:', otherJobs);
    }
}

verifyKakaoJobs().catch(console.error);
