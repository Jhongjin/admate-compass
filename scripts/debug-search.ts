import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function testSearch() {
    const query = '광고 정책은';
    console.log(`🔍 검색 테스트: "${query}"`);

    // RAGProcessor 등의 복잡한 로직 대신 직접 rpc 또는 similarity 검색 시도
    // 여기서는 실제 서비스에서 쓰는 것과 유사하게 search_similar_chunks 호출 (있다면)
    // 아니면 단순 매칭
    const { data, error } = await supabase.rpc('search_similar_chunks', {
        query_embedding: new Array(1024).fill(0), // 더미 임베딩 (실제로는 생성 필요)
        similarity_threshold: 0.1,
        match_limit: 50
    });

    if (error) {
        console.error('❌ RPC 실패:', error);
        // 폴백: 컬럼 기반 검색 시도
        const { data: docs } = await supabase
            .from('documents')
            .select('title, source_vendor')
            .ilike('content', '%광고%정책%')
            .limit(20);
        console.log('📄 문서 검색 결과 (위치기반):', docs?.map(d => `${d.source_vendor}: ${d.title}`));
    } else {
        console.log('✅ RPC 검색 성공');
    }
}

testSearch().catch(console.error);
