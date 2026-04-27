import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// .env.local 파일 로드
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkJobs() {
    const { data, error, count } = await supabase
        .from('processing_jobs')
        .select('*', { count: 'exact' })
        .eq('job_type', 'CRAWL_SEED')
        .contains('payload', { vendor: 'INSTAGRAM' })
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('❌ 조회 실패:', error.message);
        process.exit(1);
    }

    console.log(`📊 등록된 인스타그램 작업 수: ${count}개`);

    if (data && data.length > 0) {
        console.log('✅ 최신 등록 작업 샘플 (3개):');
        data.slice(0, 3).forEach(job => {
            console.log(`- ID: ${job.id}, Status: ${job.status}, URL: ${(job.payload as any).url}`);
        });
    } else {
        console.log('❌ 등록된 작업이 없습니다.');
    }
}

checkJobs();
