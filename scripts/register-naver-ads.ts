/**
 * 네이버 광고 도움말 전체 ID 스캔 및 큐 등록 실행 스크립트
 * 
 * 실행: npx tsx scripts/register-naver-ads.ts
 */

import { naverAdsCrawlingService } from '../src/lib/services/NaverAdsCrawlingService';
import * as dotenv from 'dotenv';
import path from 'path';

// .env.local 로드 (Supabase 설정용)
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function main() {
    console.log('🚀 [NaverAdsRegistration] 네이버 광고 도움말 전체 스캔 및 등록 시작 (ID 1 ~ 1000)...');

    try {
        const result = await naverAdsCrawlingService.discoverAndEnqueue(1, 1000, 20);

        console.log('\n✨ [NaverAdsRegistration] 등록 작업 완료!');
        console.log(`- 발견된 유효 URL: ${result.discovered.length}개`);
        console.log(`- 신규 큐 등록 성공: ${result.enqueued}개`);
        console.log(`- 에러 발생: ${result.errors}개`);

        if (result.discovered.length > 0) {
            console.log('\n🔗 발견된 주요 URL 예시:');
            result.discovered.slice(0, 5).forEach(url => console.log(`  * ${url}`));
        }
    } catch (error) {
        console.error('\n❌ [NaverAdsRegistration] 작업 중 치명적 오류 발생:', error);
    }
}

main().catch(console.error);
