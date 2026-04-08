
import { createPureClient } from '@/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function highReliabilityReset() {
    const supabase = await createPureClient();

    console.log('🔄 [HiRelReset] All Non-Completed Jobs 강제 초기화...');

    // 1. 모든 비완료 작업을 강제로 대기열로 리셋
    const { data, error } = await supabase
        .from('processing_jobs')
        .update({
            status: 'queued',
            error: null,
            started_at: null,
            attempts: 0
        })
        .neq('status', 'completed')
        .select();

    if (error) {
        console.error('❌ Reset Error:', error);
    } else {
        console.log(`✅ ${data?.length || 0}개의 작업을 다시 대기열(queued)로 이동했습니다.`);
    }

    // 2. Docs 테이블도 필수로 리셋
    const { data: docs, error: docError } = await supabase
        .from('documents')
        .update({ status: 'pending' })
        .eq('status', 'failed')
        .eq('source_vendor', 'NAVER')
        .select();

    if (docError) {
        console.error('❌ Doc Reset Error:', docError);
    } else {
        console.log(`✅ ${docs?.length || 0}개의 문서를 다시 pending 상태로 초기화했습니다.`);
    }
}

highReliabilityReset().catch(console.error);
