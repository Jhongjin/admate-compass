import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function removeMeta404s() {
    console.log('🧹 Meta 404(콘텐츠 없음) 작업 및 문서 제거 시작...');

    // 1. Meta 벤더이면서 chunkCount가 0인 완료된 작업 조회
    const { data: emptyJobs, error: fetchErr } = await supabase
        .from('processing_jobs')
        .select('id, document_id, payload, result')
        .eq('status', 'completed')
        .contains('payload', { vendors: ['META'] });

    if (fetchErr) {
        console.error('❌ 작업 조회 실패:', fetchErr);
        return;
    }

    const jobsToRemove = emptyJobs?.filter(job => (job.result as any)?.chunkCount === 0) || [];

    if (jobsToRemove.length === 0) {
        console.log('✅ 제거할 404 작업이 없습니다.');
        return;
    }

    console.log(`📊 총 ${jobsToRemove.length}개의 404 작업을 제거합니다.`);

    for (const job of jobsToRemove) {
        console.log(`🗑️ 제거 중: ${job.payload.url}`);

        // 1. 작업 삭제
        const { error: jobDelErr } = await supabase.from('processing_jobs').delete().eq('id', job.id);
        if (jobDelErr) console.error(`   - 작업 삭제 실패: ${jobDelErr.message}`);

        // 2. 문서 삭제
        if (job.document_id) {
            const { error: docDelErr } = await supabase.from('documents').delete().eq('id', job.document_id);
            if (docDelErr) console.error(`   - 문서 삭제 실패: ${docDelErr.message}`);
        }
    }

    console.log(`\n✨ 총 ${jobsToRemove.length}개의 Meta 404 데이터가 완벽하게 제거되었습니다.`);
}

removeMeta404s();
