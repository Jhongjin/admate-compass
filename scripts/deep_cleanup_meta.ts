import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function deepCleanupMeta() {
    console.log('🚀 Meta 실패 작업 전수 조사 및 정밀 정리 시작...');

    // 실패했거나, 결과에 오류가 있거나, 장시간 머물러 있는 META 작업 조회
    const { data: troubledJobs, error } = await supabase
        .from('processing_jobs')
        .select('id, payload, document_id, status, result, updated_at')
        .contains('payload', { vendors: ['META'] })
        .or('status.eq.failed,status.eq.processing,status.eq.queued');

    if (error) {
        console.error('❌ 작업 조회 실패:', error);
        return;
    }

    if (!troubledJobs || troubledJobs.length === 0) {
        console.log('✅ 정리할 대상 작업이 없습니다.');
        return;
    }

    // 실제로 문제가 있는 작업만 필터링 (이미 완료되었거나 정상 진행 중인 것 제외)
    const jobsToProcess = troubledJobs.filter(job => {
        // 1. 상태가 failed인 경우
        if (job.status === 'failed') return true;

        // 2. 상태가 processing인데 장시간(30분 이상) 정지된 경우
        if (job.status === 'processing') {
            const updatedAt = new Date(job.updated_at || 0).getTime();
            const now = Date.now();
            return (now - updatedAt) > 30 * 60 * 1000;
        }

        // 3. 상태가 queued이지만 이미 결과가 failed인 경우 (재시도 필요)
        if (job.status === 'queued' && (job.result as any)?.error) return true;

        return false;
    });

    if (jobsToProcess.length === 0) {
        console.log('✅ 정밀 분석 결과, 실제로 정리가 필요한 작업이 없습니다.');
        return;
    }

    console.log(`📊 총 ${jobsToProcess.length}개의 의심 작업을 정밀 검사합니다.`);

    let removedCount = 0;
    let retriedCount = 0;
    let skippedCount = 0;

    for (const job of jobsToProcess) {
        const url = job.payload.url;
        if (!url) continue;

        try {
            // 1. URL 유효성 체크 (실제 브라우저 유저 에이전트 사용)
            const resp = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
                },
                redirect: 'follow', // 리다이렉트 추적
                signal: AbortSignal.timeout(15000)
            }).catch(e => ({ status: 0, url: url, text: () => Promise.resolve('') }));

            const finalUrl = (resp as any).url || url;
            const status = (resp as any).status;
            const text = status !== 0 ? await (resp as any).text() : '';

            // 404, 존재하지 않는 페이지, 로그인 페이지로의 리다이렉트 여부 판단
            const is404 = status === 404 ||
                text.includes('페이지를 찾을 수 없음') ||
                text.includes('Page Not Found') ||
                text.includes('콘텐츠를 찾을 수 없습니다') ||
                finalUrl.includes('/login/') || // 로그인 페이지 리다이렉트
                finalUrl.includes('checkpoint') || // 보안 체크포인트
                text.includes('Sorry, this content isn\'t available') ||
                text.includes('본문으로 이동'); // 404 페이지의 특정 문구 (확인 필요)

            if (is404) {
                // 접근 불가 -> 제거
                console.log(`🗑️ [제거] 접근 불가 (404/Login): ${url}`);
                await supabase.from('processing_jobs').delete().eq('id', job.id);
                if (job.document_id) {
                    await supabase.from('documents').delete().eq('id', job.document_id);
                }
                removedCount++;
            } else {
                // 정상 오픈 가능 -> 재시작
                console.log(`🔄 [재시도] 유효 페이지 확인: ${url}`);
                await supabase.from('processing_jobs').update({
                    status: 'queued',
                    error: null,
                    attempts: 0,
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
            console.error(`❌ 처리 중 오류 (${url}):`, (err as any).message);
            skippedCount++;
        }
    }

    console.log('\n✨ 정밀 정리 완료 보고:');
    console.log(`- 제거(불가): ${removedCount}개`);
    console.log(`- 재시작(유효): ${retriedCount}개`);
    console.log(`- 스킵: ${skippedCount}개`);
}

deepCleanupMeta();
