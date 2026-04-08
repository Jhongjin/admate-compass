/**
 * 네이버 광고 도움말 순차 ID 스캔 및 큐 등록 테스트 스크립트
 * 
 * 실행: npx ts-node scripts/test-naver-discovery.ts
 */

import { naverAdsCrawlingService } from '../src/lib/services/NaverAdsCrawlingService';
import * as dotenv from 'dotenv';
import path from 'path';

// .env.local 로드
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function runTest() {
    console.log('🧪 [Test] 네이버 광고 도움말 발견 테스트 시작...');

    // 테스트 범위 (알려진 유효 ID 포함: 302, 547)
    const testRanges = [
        { start: 300, end: 305 },
        { start: 545, end: 550 }
    ];

    for (const range of testRanges) {
        console.log(`\n📂 [Test] 범위 테스트: ${range.start} ~ ${range.end}`);
        try {
            const result = await naverAdsCrawlingService.discoverAndEnqueue(range.start, range.end, 10);
            console.log('📊 [Test] 결과:', result);

            if (result.discovered.length > 0) {
                console.log('✅ [Test] 유효한 URL 발견 성공!');
            } else {
                console.warn('⚠️ [Test] 유효한 URL을 발견하지 못했습니다. (범위 확인 필요)');
            }
        } catch (error) {
            console.error('❌ [Test] 에러 발생:', error);
        }
    }

    console.log('\n🏁 [Test] 모든 테스트 완료');
}

runTest().catch(console.error);
