import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// .env 파일 로드
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Supabase 설정이 비어있습니다.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function retryMetaFailedJobs() {
    console.log('🔄 실패한 Meta 크롤링 작업 재시작 준비 중...');

    // 1. 실패한 Meta 작업들 가져오기 (CRAWL_SEED 타입)
    const { data: failedJobs, error: fetchError } = await supabase
        .from('processing_jobs')
        .select('id, document_id')
        .eq('job_type', 'CRAWL_SEED')
        .eq('status', 'failed')
        .contains('payload', { vendors: ['META'] });

    if (fetchError) {
        console.error('❌ 실패 작업 조회 중 에러:', fetchError);
        return;
    }

    if (!failedJobs || failedJobs.length === 0) {
        console.log('✅ 재시작할 Meta 실패 작업이 없습니다.');
        return;
    }

    console.log(`📊 총 ${failedJobs.length}개의 실패 작업을 재처리합니다.`);

    const jobIds = failedJobs.map(j => j.id);
    const docIds = failedJobs.map(j => j.document_id).filter(Boolean);

    // 2. 작업들의 상태를 'queued'로 변경
    const { error: jobUpdateError } = await supabase
        .from('processing_jobs')
        .update({
            status: 'queued',
            error: null,
            started_at: null,
            finished_at: null,
            updated_at: new Date().toISOString()
        })
        .in('id', jobIds);

    if (jobUpdateError) {
        console.error('❌ 작업 큐 초기화 실패:', jobUpdateError);
    } else {
        console.log(`✅ ${jobIds.length}개 작업 큐 등록 완료 (status: queued)`);
    }

    // 3. 관련 문서들의 상태를 'pending'으로 변경
    if (docIds.length > 0) {
        const { error: docUpdateError } = await supabase
            .from('documents')
            .update({
                status: 'pending',
                updated_at: new Date().toISOString()
            })
            .in('id', docIds);

        if (docUpdateError) {
            console.error('❌ 문서 상태 초기화 실패:', docUpdateError);
        } else {
            console.log(`✅ ${docIds.length}개 문서 상태 초기화 완료 (status: pending)`);
        }
    }

    console.log('✨ 모든 재시작 처리가 완료되었습니다. 큐 워커에 의해 순차적으로 처리됩니다.');
}

retryMetaFailedJobs().catch(console.error);
