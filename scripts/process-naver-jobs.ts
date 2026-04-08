import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// .env.local 수동 로드 및 강제 주입
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const openAIKeyMatch = envContent.match(/^OPENAI_API_KEY=(.*)$/m);
    if (openAIKeyMatch && openAIKeyMatch[1]) {
        const key = openAIKeyMatch[1].trim();
        process.env.OPENAI_API_KEY = key;
        process.env.OPENAI_EMBEDDING_API_KEY = key;
        console.log(`✅ [ManualEnv] OpenAI API 키 강제 주입 성공 (${key.substring(0, 10)}...)`);
    }
}
dotenv.config({ path: envPath });

import { CrawlerEngine } from '@/lib/crawler-v2/core/CrawlerEngine';
import { RAGProcessor } from '@/lib/services/RAGProcessor';
import { createPureClient } from '@/lib/supabase/pure';
import { openAIEmbeddingService } from '@/lib/services/OpenAIEmbeddingService';

// 임베딩 서비스 강제 재초기화 (수동 로드된 키 반영)
if (process.env.OPENAI_API_KEY) {
    openAIEmbeddingService.reinitialize();
}

async function processNaverJobs() {
    console.log('🚀 [NaverProcessor] 네이버 광고 작업 처리 시작 (무한 루프 모드)...');

    const supabase = await createPureClient();
    if (!supabase) {
        console.error('❌ Supabase 클라이언트 생성 실패');
        return;
    }

    const crawlerEngine = new CrawlerEngine();
    const ragProcessor = new RAGProcessor();

    let hasMore = true;
    let totalProcessed = 0;

    while (hasMore) {
        // 1. 대기 중인 네이버 작업 조회
        const { data: jobs, error } = await supabase
            .from('processing_jobs')
            .select('*')
            .eq('status', 'queued')
            .eq('job_type', 'CRAWL')
            .contains('payload', { vendor: 'NAVER' })
            .order('priority', { ascending: false })
            .order('created_at', { ascending: true })
            .limit(20);

        if (error) {
            console.error('❌ 작업 조회 오류:', error);
            break;
        }

        if (!jobs || jobs.length === 0) {
            console.log('✨ [NaverProcessor] 더 이상 처리할 대기 작업이 없습니다.');
            hasMore = false;
            break;
        }

        console.log(`\n📦 새 배치 시작 (${jobs.length}개 작업, 현재까지 처리: ${totalProcessed})...`);

        for (const job of jobs) {
            const documentId = job.document_id;
            const url = job.payload.url;

            try {
                // 2. 작업 상태를 'processing'으로 변경
                await supabase
                    .from('processing_jobs')
                    .update({ status: 'processing', started_at: new Date().toISOString() })
                    .eq('id', job.id);

                console.log(`\n🔍 [Job ${job.id}] 처리 중: ${url}`);

                // 3. 크롤링 수행 (public 메서드 crawlUrl 사용으로 fetch 폴백 활성화) 🛡️
                const crawlResult = await crawlerEngine.crawlUrl(url);
                if (!crawlResult || crawlResult.status === 'failed' || !crawlResult.content) {
                    throw new Error(crawlResult.error || '크롤링 결과가 없거나 본문이 비어있습니다.');
                }

                console.log(`📄 크롤링 완료 (길이: ${crawlResult.content.length})`);

                // 4. RAG 처리 (청킹 및 임베딩)
                const ragResult = await ragProcessor.processDocument({
                    id: documentId,
                    content: crawlResult.content,
                    title: crawlResult.title || url,
                    url: url,
                    metadata: {
                        source: 'naver_ads_help',
                        vendor: 'NAVER',
                        crawled_at: new Date().toISOString()
                    }
                });

                // 5. 작업 완료 업데이트
                await supabase
                    .from('processing_jobs')
                    .update({
                        status: 'completed',
                        completed_at: new Date().toISOString(),
                        result: { chunkCount: ragResult.chunkCount }
                    })
                    .eq('id', job.id);

                // 6. 문서 상태 업데이트 (인덱싱 완료 및 본문 저장) 🛡️
                await supabase
                    .from('documents')
                    .update({
                        status: 'indexed',
                        content: crawlResult.content, // 본문 직접 저장 추가
                        size: crawlResult.content.length, // 사이즈 저장 추가
                        chunk_count: ragResult.chunkCount,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', documentId);

                totalProcessed++;
                console.log(`✅ [Job ${job.id}] 처리 성공! (청크: ${ragResult.chunkCount})`);

            } catch (err) {
                console.error(`❌ [Job ${job.id}] 처리 중 오류:`, err);

                await supabase
                    .from('processing_jobs')
                    .update({
                        status: 'failed',
                        error: err instanceof Error ? err.message : String(err),
                        attempts: (job.attempts || 0) + 1
                    })
                    .eq('id', job.id);

                await supabase
                    .from('documents')
                    .update({ status: 'failed', updated_at: new Date().toISOString() })
                    .eq('id', documentId);
            }
        }
    }

    console.log(`\n🏁 [NaverProcessor] 전체 작업 완료. 총 ${totalProcessed}개의 문서를 인덱싱했습니다.`);
}

processNaverJobs().catch(console.error);
