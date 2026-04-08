/**
 * 네이버 광고 도움말 순차 ID 스캔 및 큐 등록 테스트 스크립트 (Standalone)
 * 
 * 실행: npx tsx scripts/test-naver-discovery-standalone.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// .env.local 로드
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const BASE_URL = 'https://ads.naver.com/help/faq/';

async function runTest() {
    console.log('🧪 [Test] 네이버 광고 도움말 발견 테스트 시작 (Standalone)...');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('❌ Supabase 환경 변수가 없습니다. .env.local 파일을 확인하세요.');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 테스트 범위 (알려진 유효 ID 포함: 302, 547)
    const testRanges = [
        { start: 300, end: 305 },
        { start: 545, end: 550 }
    ];

    for (const range of testRanges) {
        console.log(`\n📂 [Test] 범위 테스트: ${range.start} ~ ${range.end}`);

        for (let id = range.start; id <= range.end; id++) {
            const url = `${BASE_URL}${id}`;
            try {
                const response = await fetch(url, {
                    method: 'HEAD',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    }
                });

                if (response.ok) {
                    console.log(`✅ [Test] 유효 URL 발견: ${url}`);

                    // 1. 문서 등록 시뮬레이션 (NaverAdsCrawlingService 로직 반영)
                    const documentId = `doc_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                    console.log(`💾 [Test] 문서 등록 시뮬레이션: ${documentId} (URL: ${url})`);

                    const { error: docError } = await supabase
                        .from('documents')
                        .insert({
                            id: documentId,
                            url,
                            title: url,
                            type: 'url',
                            status: 'pending',
                            source_vendor: 'NAVER',
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        });

                    if (docError) {
                        console.error(`❌ [Test] 문서 등록 실패 (${url}):`, docError.message);
                        continue;
                    }

                    // 2. 큐 등록 시뮬레이션
                    const insertData = {
                        document_id: documentId,
                        job_type: 'CRAWL',
                        status: 'queued',
                        priority: 5,
                        payload: {
                            url,
                            vendor: 'NAVER',
                            options: {
                                discoverSubPages: false,
                                useCache: true
                            },
                            source: 'sequential_scan_test'
                        },
                        scheduled_at: new Date().toISOString(),
                        attempts: 0,
                        max_attempts: 3
                    };

                    const { data, error } = await supabase
                        .from('processing_jobs')
                        .insert(insertData)
                        .select('id')
                        .single();

                    if (error) {
                        console.error(`❌ [Test] ID ${id} 큐 등록 실패:`, error.message);
                    } else {
                        console.log(`🚀 [Test] ID ${id} 큐 등록 성공 (Job ID: ${data.id})`);
                    }
                } else {
                    console.log(`⚪ [Test] ID ${id} 무효 (Status: ${response.status})`);
                }
            } catch (error) {
                console.error(`❌ [Test] ID ${id} 체크 중 에러:`, error);
            }
        }
    }

    console.log('\n🏁 [Test] 모든 테스트 완료');
}

runTest().catch(console.error);
