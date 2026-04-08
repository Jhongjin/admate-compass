import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// .env.local 파일 로드
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ 환경 변수가 설정되지 않았습니다. (.env.local 확인)');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixXVendor() {
    console.log('🚀 Supabase 데이터 수정 시작 (x.com -> X(TWITTER))...');

    // 1. documents 테이블 업데이트
    console.log('📝 documents 테이블 업데이트 중...');
    const { data: docData, error: docError, count: docCount } = await supabase
        .from('documents')
        .update({ source_vendor: 'X(TWITTER)' })
        .ilike('url', '%x.com%')
        .select('id');

    if (docError) {
        console.error('❌ documents 업데이트 실패:', docError);
    } else {
        console.log(`✅ documents 업데이트 완료: ${docData?.length || 0}개 행 수정됨`);
    }

    // 2. chunks 테이블 업데이트 (metadata 내의 source_vendor 수정)
    // 주의: Supabase JSONB 업데이트는 복잡할 수 있으므로, 
    // 여기서는 단순히 영향을 받은 document_id를 가진 청크들을 확인하거나
    // 가능하다면 JSONB_SET 같은 방식으로 업데이트해야 함.
    // 하지만 이 프로젝트의 RAGProcessor는 검색 시 document 정보를 조인해서 가져오기도 함.

    // 간단하게 하기 위해, affected document IDs를 가져와서 해당 청크들의 metadata 업데이트 시도
    if (docData && docData.length > 0) {
        const docIds = docData.map(d => d.id);
        console.log(`🧩 관련 chunks_${docIds.length}개 문서의 청크 업데이트 시도...`);

        // 원시 쿼리를 날릴 수 없으므로, 루프를 돌거나 
        // 하이브리드 검색 등에서 document 정보를 우선순위로 쓰도록 유도하는 것이 좋음.
        // 여기서는 일단 metadata.source_vendor를 직접 수정하는 것이 정석.

        // Supabase JS SDK에서 JSONB 내부 필드 일괄 업데이트는 제한적이므로 
        // SQL Editor 권장 혹은 간단한 루프 처리
        let updatedChunks = 0;
        for (const id of docIds) {
            // 해당 document의 모든 chunks 가져오기
            const { data: chunks } = await supabase
                .from('chunks')
                .select('id, metadata')
                .eq('document_id', id);

            if (chunks) {
                for (const chunk of chunks) {
                    const newMetadata = { ...chunk.metadata, source_vendor: 'X(TWITTER)' };
                    await supabase
                        .from('chunks')
                        .update({ metadata: newMetadata })
                        .eq('id', chunk.id);
                    updatedChunks++;
                }
            }
        }
        console.log(`✅ chunks 업데이트 완료: ${updatedChunks}개 청크 수정됨`);
    }

    console.log('✨ 모든 작업이 완료되었습니다.');
}

fixXVendor().catch(console.error);
