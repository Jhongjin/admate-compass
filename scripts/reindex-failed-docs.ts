
import { createPureClient } from '../src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function reindexFailedDocs() {
    console.log('🚀 [Reindex] Failed documents 리셋 작업 시작 (v2)...');
    const supabase = await createPureClient();

    // 1. 대상 조회 (status='failed')
    // 팀장님 요청에 따라 'chunk_count가 진행되지 못한' 기준을 포함하여 failed 전체 대상
    console.log('🔍 1. status=failed 문서 조회 중...');
    const { data: failedDocs, error: fetchError } = await supabase
        .from('documents')
        .select('id, url, source_vendor, title, chunk_count')
        .eq('status', 'failed');

    if (fetchError) {
        console.error('❌ 대상 조회 실패:', fetchError);
        return;
    }

    if (!failedDocs || failedDocs.length === 0) {
        console.log('✅ 리셋할 대상 문서가 없습니다.');
        return;
    }

    console.log(`📊 리셋 대상 문서 수: ${failedDocs.length}개`);

    // 2. documents 테이블 리셋 (status='pending')
    console.log('📝 2. documents 테이블 상태 업데이트 중 (pending)...');
    const docIds = failedDocs.map(d => d.id);
    const { error: updateError } = await supabase
        .from('documents')
        .update({
            status: 'pending',
            updated_at: new Date().toISOString()
        })
        .in('id', docIds);

    if (updateError) {
        console.error('❌ documents 업데이트 실패:', updateError);
        return;
    }
    console.log(`✅ ${docIds.length}개의 문서를 pending으로 변경했습니다.`);

    // 3. processing_jobs 테이블에 작업 등록 (CRAWL)
    console.log('📦 3. processing_jobs 대기열에 작업 추가 중...');

    // 이전에 실패한 작업들을 'queued'로 리셋 (payload->>url 매칭 대신 document_id 매칭 사용)
    const { error: resetError } = await supabase
        .from('processing_jobs')
        .update({
            status: 'queued',
            error: null,
            started_at: null,
            attempts: 0,
            scheduled_at: new Date().toISOString()
        })
        .in('document_id', docIds)
        .neq('status', 'completed');

    if (resetError) {
        console.warn('⚠️ processing_jobs 리셋 중 일부 오류 (작업이 없을 수 있음):', resetError);
    } else {
        console.log('✅ 기존 작업들을 queued로 리셋했습니다.');
    }

    // 작업이 아예 등록되지 않았던 문서들을 위해 명시적으로 신규 INSERT 시도 (job_type: CRAWL)
    // NaverAdsCrawlingService가 'CRAWL'을 사용하므로 동일하게 맞춤
    const inserts = failedDocs.map(doc => ({
        document_id: doc.id,
        job_type: 'CRAWL', // NaverAdsCrawlingService에서 사용하는 타입
        status: 'queued',
        priority: 5,
        payload: {
            url: doc.url,
            vendor: doc.source_vendor || 'NAVER',
            options: {
                discoverSubPages: false,
                useCache: false
            },
            source: 'manual_reindex_v2',
            enqueued_at: new Date().toISOString(),
        },
        scheduled_at: new Date().toISOString(),
        attempts: 0,
        max_attempts: 3,
    }));

    // 배치 처리 (chunk size: 50)
    const chunkSize = 50;
    let insertedCount = 0;
    for (let i = 0; i < inserts.length; i += chunkSize) {
        const chunk = inserts.slice(i, i + chunkSize);
        // upsert 또는 ignore 처리가 안 되므로, 중복 에러가 날 수 있음. 
        // 여기서는 insert 시도 후 에러 무시하거나 upsert 사용 (document_id + job_type 유니크 시)
        const { error: insertError } = await supabase
            .from('processing_jobs')
            .upsert(chunk, { onConflict: 'document_id, job_type' }); // 유니크 제약 상황 가정하여 upsert 시도

        if (insertError) {
            console.warn(`💡 일부 작업은 이미 존재하거나 등록에 실패했습니다 (index ${i}):`, insertError.message);
        } else {
            insertedCount += chunk.length;
        }
    }

    console.log(`🚀 총 ${insertedCount}개의 작업을 대기열(upsert)에 등록 완료했습니다.`);
    console.log('✨ 리셋 작업이 성공적으로 끝났습니다. 이제 크롤러가 대기열에서 처리할 것입니다.');
}

reindexFailedDocs().catch(console.error);
