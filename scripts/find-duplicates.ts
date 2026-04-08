
import { createPureClient } from '../src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function findDuplicateUrls() {
    console.log('🔍 [FindDuplicates] 중복 URL 조회 시작...');
    const supabase = await createPureClient();

    // 1. 중복된 URL 목록 추출 (count > 1)
    const { data: duplicateUrls, error: urlError } = await supabase
        .rpc('get_duplicate_urls'); // RPC가 없다면 직접 쿼리

    // rpc가 없을 경우를 대비한 직접 조회 방식
    if (urlError) {
        console.log('⚠️ RPC 조회 실패, 직접 조회를 시도합니다...');
        const { data: allDocs, error: docError } = await supabase
            .from('documents')
            .select('id, url, created_at, status')
            .order('url', { ascending: true })
            .order('created_at', { ascending: false });

        if (docError) {
            console.error('❌ 문서 조회 실패:', docError);
            return;
        }

        const urlGroups = new Map<string, any[]>();
        allDocs.forEach(doc => {
            if (!urlGroups.has(doc.url)) {
                urlGroups.set(doc.url, []);
            }
            urlGroups.get(doc.url)!.push(doc);
        });

        const duplicates = Array.from(urlGroups.entries())
            .filter(([url, group]) => group.length > 1);

        console.log(`📊 중복된 URL 그룹 수: ${duplicates.length}개`);

        let totalDuplicatesToDelete = 0;
        duplicates.forEach(([url, group]) => {
            const keeper = group[0]; // 최신 데이터 (keeper)
            const deletes = group.slice(1); // 삭제 대상 (old data)
            totalDuplicatesToDelete += deletes.length;
            console.log(`- URL: ${url} | Total: ${group.length} | To Delete: ${deletes.length}`);
            console.log(`  └ Keep: ${keeper.id} (${keeper.created_at})`);
            deletes.forEach(d => console.log(`  └ Delete: ${d.id} (${d.created_at})`));
        });

        console.log(`\n🔥 총 삭제 예정 문서 수: ${totalDuplicatesToDelete}개`);
    }
}

findDuplicateUrls().catch(console.error);
