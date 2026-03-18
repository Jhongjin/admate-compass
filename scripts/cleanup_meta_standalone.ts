import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import puppeteer from 'puppeteer-core';
import fs from 'fs';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Windows용 브라우저 경로 후보
const browserPaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

async function cleanupMeta404s() {
    console.log('🔍 META 실패 작업 정리 시작 (Standalone Mode)...');

    const executablePath = browserPaths.find(p => fs.existsSync(p));
    if (!executablePath) {
        console.error('❌ 브라우저(Chrome/Edge)를 찾을 수 없습니다.');
        return;
    }
    console.log(`🚀 브라우저 경로: ${executablePath}`);

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

    const browser = await puppeteer.launch({
        executablePath,
        headless: true
    });

    let removedCount = 0;
    let retriedCount = 0;
    let errorCount = 0;

    // 병렬 처리를 위해 배치 분할
    const BATCH_SIZE = 5;
    for (let i = 0; i < failedJobs.length; i += BATCH_SIZE) {
        const batch = failedJobs.slice(i, i + BATCH_SIZE);
        console.log(`\n📦 배치 처리 중 (${i + 1}~${Math.min(i + BATCH_SIZE, failedJobs.length)} / ${failedJobs.length})`);

        await Promise.all(batch.map(async (job) => {
            const url = job.payload.url;
            const page = await browser.newPage();
            try {
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

                // 타임아웃 20초 (빠르게 확인)
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

                const title = await page.title();
                const content = await page.evaluate(() => document.body.innerText);

                const is404 = title.includes('페이지를 찾을 수 없음') ||
                    title.includes('Page Not Found') ||
                    content.includes('페이지를 찾을 수 없습니다') ||
                    content.includes('콘텐츠를 찾을 수 없습니다') ||
                    content.includes('Sorry, this content isn\'t available');

                if (is404) {
                    console.log(`🗑️ 제거 (404): ${url}`);
                    await supabase.from('processing_jobs').delete().eq('id', job.id);
                    if (job.document_id) {
                        await supabase.from('documents').delete().eq('id', job.document_id);
                    }
                    removedCount++;
                } else {
                    console.log(`🔄 재시도 (유효): ${url} [${title.substring(0, 20)}]`);
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
            } finally {
                await page.close();
            }
        }));
    }

    await browser.close();

    console.log('\n✨ 최종 정리 결과:');
    console.log(`- 제거(404): ${removedCount}개`);
    console.log(`- 재시작(유효): ${retriedCount}개`);
    console.log(`- 오류: ${errorCount}개`);
    process.exit(0);
}

cleanupMeta404s().catch(e => { console.error(e); process.exit(1); });
