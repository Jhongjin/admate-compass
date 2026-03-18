import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { PuppeteerCrawlingService } from '../src/lib/services/PuppeteerCrawlingService.js';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanupMeta404s() {
    console.log('🔍 META 실패 작업 정밀 분석 시작 (PuppeteerCrawlingService 사용)...');

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

    const puppeteerService = new PuppeteerCrawlingService();

    let removedCount = 0;
    let retriedCount = 0;
    let errorCount = 0;

    for (const job of failedJobs) {
        const url = job.payload.url;
        console.log(`\n🔎 검사 중: ${url}`);

        try {
            // 404 여부만 빠르게 확인하기 위해 subpage 추출 제외
            const result = await puppeteerService.crawlMetaPage(url, false, true);

            const is404 = result && (result.error === '404 Page Not Found' ||
                result.title.includes('페이지를 찾을 수 없음') ||
                result.title.includes('Page Not Found'));

            if (result && is404) {
                console.log(`🗑️ 제거 (404): ${url}`);
                await supabase.from('processing_jobs').delete().eq('id', job.id);
                if (job.document_id) {
                    await supabase.from('documents').delete().eq('id', job.document_id);
                }
                removedCount++;
            } else if (result) {
                console.log(`🔄 재시도 (유효): ${url} (Title: ${result.title.substring(0, 30)}...)`);
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
            }
        } catch (err) {
            console.error(`❌ 오류 (${url}):`, (err as any).message);
            errorCount++;
        }
    }

    console.log('\n✨ 최종 정리 결과:');
    console.log(`- 제거(404): ${removedCount}개`);
    console.log(`- 재시작(유효): ${retriedCount}개`);
    console.log(`- 오류/스킵: ${errorCount}개`);

    process.exit(0);
}

cleanupMeta404s().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
