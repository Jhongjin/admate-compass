/**
 * 인스타그램 고객센터 사이트맵 등록 및 큐 추가 스크립트
 * 
 * 실행: npx tsx scripts/register_instagram_help_sitemap.ts
 */

import { sitemapDiscoveryService } from '../src/lib/services/SitemapDiscoveryService';
import { createPureClient } from '../src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

// .env.local 로드 (Supabase 설정용)
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function main() {
    const homeUrl = 'https://help.instagram.com/';
    console.log(`🚀 [InstagramRegistration] 인스타그램 고객센터 홈에서 탐색 시작: ${homeUrl}`);

    try {
        // 1. 브라우저/서비스 초기화
        await sitemapDiscoveryService.initialize();

        // 2. BFS 탐색 실행
        // 사이트맵이 로그인 벽으로 막혀 있으므로, 홈페이지부터 링크를 따라가며 탐색 (BFS)
        // maxDepth 3으로 설정하여 카테고리 -> 서브카테고리 -> 문서를 찾도록 함
        const discoveredUrls = await sitemapDiscoveryService.discoverSubPages(homeUrl, {
            maxDepth: 3,
            maxUrls: 5000,
            respectRobotsTxt: false, // 로봇 배제 표준 무시 (이미 robots.txt에서 허용된 sitemap을 처리하려는 것이므로)
            domainLimit: true,
            strictPathLimit: false
        });

        console.log(`📊 [InstagramRegistration] 발견된 URL 총 ${discoveredUrls.length}개`);

        if (discoveredUrls.length === 0) {
            console.error('❌ [InstagramRegistration] 발견된 URL이 없습니다. 사이트맵 접근 권한이나 형식을 확인하세요.');
            return;
        }

        // 3. Supabase 클라이언트 준비
        const supabase = await createPureClient();

        // 4. 큐 등록 데이터 생성 (CRAWL_SEED 타입)
        const jobEntries = discoveredUrls.map(item => ({
            job_type: 'CRAWL_SEED',
            status: 'queued',
            priority: 5,
            payload: {
                url: item.url,
                vendors: ['META'],
                forceCrawl: true,
                respectRobots: true
            },
            scheduled_at: new Date().toISOString(),
            attempts: 0,
            max_attempts: 3
        }));

        console.log(`🚀 [InstagramRegistration] ${jobEntries.length}개 작업을 processing_jobs 테이블에 등록 중...`);

        // 5. 배치 삽입 (100개씩)
        const BATCH_SIZE = 100;
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < jobEntries.length; i += BATCH_SIZE) {
            const batch = jobEntries.slice(i, i + BATCH_SIZE);
            const { error } = await supabase.from('processing_jobs').insert(batch);

            if (error) {
                console.error(`❌ [InstagramRegistration] 배치 ${Math.floor(i / BATCH_SIZE) + 1} 등록 실패:`, error.message);
                failCount += batch.length;
            } else {
                successCount += batch.length;
                console.log(`⏳ [InstagramRegistration] 진행 상황: ${successCount} / ${jobEntries.length} 완료`);
            }
        }

        console.log(`\n✨ [InstagramRegistration] 모든 등록 작업이 완료되었습니다!`);
        console.log(`- 총 발견: ${jobEntries.length}개`);
        console.log(`- 등록 성공: ${successCount}개`);
        console.log(`- 등록 실패: ${failCount}개`);

        if (successCount > 0) {
            console.log('\n💡 등록된 URL은 Cron Job 또는 consume API를 통해 순차적으로 크롤링됩니다.');
        }

    } catch (error) {
        console.error('\n❌ [InstagramRegistration] 작업 중 치명적 오류 발생:', error);
    } finally {
        // 6. 리소스 정리
        await sitemapDiscoveryService.close();
    }
}

// 스크립트 실행
main().catch(error => {
    console.error('Unhandled error in script:', error);
    process.exit(1);
});
