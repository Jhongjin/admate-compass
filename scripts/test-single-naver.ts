
import { CrawlerEngine } from '@/lib/crawler-v2/core/CrawlerEngine';
import { RAGProcessor } from '@/lib/services/RAGProcessor';
import { createPureClient } from '@/lib/supabase/pure';
import { OpenAIEmbeddingService } from '@/lib/services/OpenAIEmbeddingService';
import * as dotenv from 'dotenv';
import path from 'path';

async function testSingle() {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

    // OpenAI Embedding Service 초기화
    if (process.env.OPENAI_API_KEY) {
        console.log('🔑 OpenAI API Key detected, reinitializing embedding service...');
        (OpenAIEmbeddingService.getInstance() as any).reinitialize();
    }

    const url = 'https://ads.naver.com/help/faq/989';
    const crawler = new CrawlerEngine();
    const supabase = await createPureClient();

    console.log(`🚀 Testing single URL: ${url}`);

    try {
        const result = await crawler.crawl(url);
        console.log('📦 Crawl Result Status:', result.status);
        console.log('📦 Content Length:', result.contentLength);

        if (result.status === 'success' && result.content) {
            console.log('📄 Content Sample:', result.content.substring(0, 200));

            console.log('🤖 Starting RAG Processing...');
            const ragProcessor = new RAGProcessor();
            const ragResult = await ragProcessor.processDocument({
                id: 'test_doc_989',
                title: result.title,
                content: result.content,
                type: 'url',
                url: url,
                source_vendor: 'NAVER'
            });

            console.log('✅ RAG Result:', ragResult);
        } else {
            console.error('❌ Crawl failed or returned no content:', result.error);
        }
    } catch (e) {
        console.error('💥 Fatal Error:', e);
    }
}

testSingle().catch(console.error);
