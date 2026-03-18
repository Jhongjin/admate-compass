import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanMetaJobs() {
    console.log('🔍 실패한 META 크롤링 작업 분석 및 정리 시작...');

    const { data: failedJobs, error } = await supabase
        .from('processing_jobs')
        .select('id, payload, document_id')
        .eq('job_type', 'CRAWL_SEED')
        .eq('status', 'failed')
        .contains('payload', { vendors: ['META'] });

    if (error) {
        console.error('❌ 작업 조회 실패:', error);
        return;
    }

    if (!failedJobs || failedJobs.length === 0) {
        console.log('✅ 정리할 실패 작업이 없습니다.');
        return;
    }

    console.log(`📊 총 ${failedJobs.length}개의 실패 작업을 검사합니다.`);

    let removedCount = 0;
    let retriedCount = 0;
    let skippedCount = 0;

    for (const job of failedJobs) {
        const url = job.payload.url;
        if (!url) continue;

        try {
            // 1. URL 유효성 체크 (404 여부 확인)
            const resp = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
                signal: AbortSignal.timeout(10000)
            }).catch(e => ({ status: 0, text: () => Promise.resolve('') }));

            const status = (resp as any).status;
            const text = status !== 0 ? await (resp as any).text() : '';

            const is404 = status === 404 || text.includes('페이지를 찾을 수 없음') || text.includes('Page Not Found') || text.includes('콘텐츠를 찾을 수 없습니다');

            if (is404) {
                // 사이트 접근 불가 (404) -> 제거
                console.log(`🗑️ 제거 대상 (404): ${url}`);

                // 1. 작업 삭제
                await supabase.from('processing_jobs').delete().eq('id', job.id);

                // 2. 관련 문서 삭제
                if (job.document_id) {
                    await supabase.from('documents').delete().eq('id', job.document_id);
                }

                removedCount++;
            } else if (status === 200) {
                // 정상 오픈 가능 -> 재시작
                console.log(`🔄 재시작 대상 (정상): ${url}`);

                await supabase.from('processing_jobs').update({
                    status: 'queued',
                    error: null,
                    updated_at: new Date().toISOString()
                }).eq('id', job.id);

                if (job.document_id) {
                    await supabase.from('documents').update({
                        status: 'pending',
                        updated_at: new Date().toISOString()
                    }).eq('id', job.document_id);
                }

                retriedCount++;
            } else {
                console.log(`⏭️ 기타 상태 (${status}): ${url}`);
                skippedCount++;
            }
        } catch (err) {
            console.error(`❌ 처리 중 오류 (${url}):`, err);
            skippedCount++;
        }
    }

    console.log('\n✨ 정리 완료 보고:');
    console.log(`- 제거(404): ${removedCount}개`);
    console.log(`- 재시작(정상): ${retriedCount}개`);
    console.log(`- 스킵: ${skippedCount}개`);
}

cleanMetaJobs();
