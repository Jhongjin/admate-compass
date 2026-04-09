
import { createPureClient } from './src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkJobErrors() {
    const supabase = await createPureClient();

    const targetUrl = 'https://ads.naver.com/help/faq/726';
    console.log(`🔍 [JobCheck] URL: ${targetUrl} 에 대한 상세 로그 분석 중...`);

    // 1. document_id 조회
    const { data: doc } = await supabase
        .from('documents')
        .select('id, status, chunk_count')
        .eq('url', targetUrl)
        .single();

    if (!doc) {
        console.error('❌ 문서를 찾을 수 없습니다.');
        return;
    }
    console.log(`📄 Document ID: ${doc.id}, Status: ${doc.status}, ChunkCount: ${doc.chunk_count}`);

    // 2. 연관된 processing_jobs 조회
    const { data: jobs, error } = await supabase
        .from('processing_jobs')
        .select('*')
        .eq('document_id', doc.id)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('❌ Job 조회 실패:', error);
        return;
    }

    if (!jobs || jobs.length === 0) {
        console.log('⚠️ 연관된 작업이 없습니다.');
        return;
    }

    console.log(`📊 발견된 작업 수: ${jobs.length}개`);
    jobs.forEach((job, index) => {
        console.log(`--- Job #${index + 1} (${job.status}) ---`);
        console.log(`  ID: ${job.id}`);
        console.log(`  Error: ${job.error}`);
        console.log(`  Result Summary: ${JSON.stringify(job.result).substring(0, 200)}...`);
        console.log(`  FinishedAt: ${job.finished_at}`);
    });
}

checkJobErrors().catch(console.error);
