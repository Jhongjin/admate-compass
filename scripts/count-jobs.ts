
import { createPureClient } from '@/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function countJobs() {
    const supabase = await createPureClient();

    console.log('📊 [NaverJobsCount] 네이버 작업 요약 통계 확인 중...');

    const { data: jobs, error } = await supabase
        .from('processing_jobs')
        .select('status, payload')
        .eq('job_type', 'CRAWL')
        .contains('payload', { vendor: 'NAVER' });

    if (error) {
        console.error('❌ 작업 조회 실패:', error);
        return;
    }

    if (!jobs || jobs.length === 0) {
        console.log('⚠️ 네이버 작업이 존재하지 않습니다.');
        return;
    }

    const stats = jobs.reduce((acc: any, job: any) => {
        acc[job.status] = (acc[job.status] || 0) + 1;
        return acc;
    }, {});

    console.log('\n📈 상태별 작업 수:');
    Object.entries(stats).forEach(([status, count]) => {
        console.log(`- ${status}: ${count}개`);
    });
    console.log(`- 총계: ${jobs.length}개`);
}

countJobs().catch(console.error);
