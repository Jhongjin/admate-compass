
import { createPureClient } from '../src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

async function recover() {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
    const supabase = await createPureClient();

    console.log('🔍 [Recovery] 오차 조사 중...');

    // 1. 모든 Naver 작업 가져오기 (URL 기반 검색으로 누락 방지) 🛡️
    const { data: jobs, error: jobError } = await supabase
        .from('processing_jobs')
        .select('*')
        .like('payload->>url', '%ads.naver.com%');

    if (jobError) throw jobError;

    // 2. 모든 Naver 문서 가져오기
    const { data: docs, error: docError } = await supabase
        .from('documents')
        .select('id')
        .eq('source_vendor', 'NAVER');

    if (docError) throw docError;

    const existingDocIds = new Set(docs.map(d => d.id));
    let recoveredCount = 0;

    console.log(`📊 Naver Jobs: ${jobs.length}, Existing Docs: ${docs.length}`);

    for (const job of jobs) {
        if (!existingDocIds.has(job.document_id)) {
            console.log(`🛠️ [${job.document_id}] 복구 중: ${job.payload.url}`);

            const { error: insError } = await supabase
                .from('documents')
                .upsert({
                    id: job.document_id,
                    url: job.payload.url,
                    title: job.payload.url,
                    type: 'url',
                    status: 'pending',
                    source_vendor: 'NAVER',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });

            if (insError) {
                console.error(`❌ 복구 실패:`, insError);
            } else {
                recoveredCount++;
            }
        }
    }

    console.log(`\n✅ 복구 완료! 총 ${recoveredCount}개의 Naver 문서를 복구했습니다.`);
}

recover().catch(console.error);
