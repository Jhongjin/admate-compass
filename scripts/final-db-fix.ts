import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function finalFix() {
    console.log('🚀 [최종 수정] x.com / twitter.com -> X(TWITTER) 일관성 작업...');

    // 1. documents 테이블 업데이트 (x.com 및 twitter.com 모두 포함)
    console.log('📝 documents 테이블 검색 및 업데이트 중...');

    // x.com 처리
    const { data: docsX } = await supabase
        .from('documents')
        .update({ source_vendor: 'X(TWITTER)' })
        .ilike('url', '%x.com%')
        .eq('source_vendor', 'OTHER')
        .select('id');

    // twitter.com 처리
    const { data: docsTwitter } = await supabase
        .from('documents')
        .update({ source_vendor: 'X(TWITTER)' })
        .ilike('url', '%twitter.com%')
        .eq('source_vendor', 'OTHER')
        .select('id');

    const allDocIds = [...(docsX || []).map(d => d.id), ...(docsTwitter || []).map(d => d.id)];
    console.log(`✅ documents 수정: ${allDocIds.length}개 (x.com: ${docsX?.length || 0}, twitter: ${docsTwitter?.length || 0})`);

    // 2. document_chunks 테이블 (JSONB metadata 필드 수정)
    if (allDocIds.length > 0) {
        let totalUpdated = 0;
        console.log(`🧩 관련 document_chunks ${allDocIds.length}개 문서에 대해 업데이트 시도...`);

        for (const docId of allDocIds) {
            const { data: chunks } = await supabase
                .from('document_chunks')
                .select('id, metadata')
                .eq('document_id', docId);

            if (chunks && chunks.length > 0) {
                for (const chunk of chunks) {
                    // metadata에 source_vendor가 없거나 OTHER인 경우 추가/수정
                    const newMetadata = { ...chunk.metadata, source_vendor: 'X(TWITTER)' };
                    await supabase
                        .from('document_chunks')
                        .update({ metadata: newMetadata })
                        .eq('id', chunk.id);
                    totalUpdated++;
                }
            }
        }
        console.log(`✅ document_chunks 수정: ${totalUpdated}개 청크`);
    }

    // 3. document_metadata 테이블 (JSONB 내 source_url 검색)
    console.log('📝 document_metadata 테이블 검색 및 업데이트 중...');
    const { data: metaX } = await supabase
        .from('document_metadata')
        .select('id, metadata')
        .ilike('metadata->>source_url', '%x.com%');

    const { data: metaTwitter } = await supabase
        .from('document_metadata')
        .select('id, metadata')
        .ilike('metadata->>source_url', '%twitter.com%');

    const allMetaRows = [...(metaX || []), ...(metaTwitter || [])];

    if (allMetaRows.length > 0) {
        let metaUpdated = 0;
        for (const row of allMetaRows) {
            if (row.metadata && (row.metadata.source_vendor === 'OTHER' || !row.metadata.source_vendor)) {
                const newMetadata = { ...row.metadata, source_vendor: 'X(TWITTER)' };
                await supabase
                    .from('document_metadata')
                    .update({ metadata: newMetadata })
                    .eq('id', row.id);
                metaUpdated++;
            }
        }
        console.log(`✅ document_metadata 수정: ${metaUpdated}개`);
    }

    console.log('✨ 모든 DB 수정이 완료되었습니다.');
}

finalFix().catch(console.error);
