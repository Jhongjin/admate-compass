import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * "Introduction to the Advertising Standards" 문서 상태 동기화
 */
async function syncDocumentStatus() {
  try {
    console.log('문서 상태 동기화 시작...');

    // "Introduction to the Advertising Standards" 문서들 조회
    const { data: documents, error: docError } = await supabase
      .from('documents')
      .select('*')
      .ilike('title', '%Introduction to the Advertising Standards%');

    if (docError) {
      throw new Error(`문서 조회 실패: ${docError.message}`);
    }

    console.log(`발견된 문서 수: ${documents?.length || 0}`);

    for (const doc of documents || []) {
      console.log(`문서 ID: ${doc.id}`);
      console.log(`제목: ${doc.title}`);
      console.log(`현재 상태: ${doc.status}`);
      console.log(`청크 수: ${doc.chunk_count}`);
      console.log(`생성일: ${doc.created_at}`);
      console.log(`업데이트일: ${doc.updated_at}`);
      console.log('---');

      // 청크가 있는지 확인
      const { data: chunks, error: chunksError } = await supabase
        .from('document_chunks')
        .select('id')
        .eq('document_id', doc.id);

      if (chunksError) {
        console.error(`청크 조회 실패 (${doc.id}):`, chunksError);
        continue;
      }

      const chunkCount = chunks?.length || 0;
      console.log(`실제 청크 수: ${chunkCount}`);

      // 상태와 청크 수가 일치하지 않는 경우 수정
      if (doc.chunk_count !== chunkCount) {
        console.log(`청크 수 불일치 감지: DB=${doc.chunk_count}, 실제=${chunkCount}`);
        
        const newStatus = chunkCount > 0 ? 'indexed' : 'failed';
        
        const { error: updateError } = await supabase
          .from('documents')
          .update({ 
            chunk_count: chunkCount,
            status: newStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', doc.id);

        if (updateError) {
          console.error(`문서 업데이트 실패 (${doc.id}):`, updateError);
        } else {
          console.log(`문서 상태 업데이트 완료: ${doc.id} -> ${newStatus} (${chunkCount} 청크)`);
        }
      } else if (doc.status === 'processing' && chunkCount > 0) {
        // 처리중 상태이지만 청크가 있는 경우 indexed로 변경
        console.log(`처리중 상태이지만 청크가 있음: ${doc.id}`);
        
        const { error: updateError } = await supabase
          .from('documents')
          .update({ 
            status: 'indexed',
            updated_at: new Date().toISOString()
          })
          .eq('id', doc.id);

        if (updateError) {
          console.error(`문서 상태 업데이트 실패 (${doc.id}):`, updateError);
        } else {
          console.log(`문서 상태 업데이트 완료: ${doc.id} -> indexed`);
        }
      }
    }

    console.log('문서 상태 동기화 완료!');

  } catch (error) {
    console.error('동기화 오류:', error);
  }
}

// 스크립트 실행
if (require.main === module) {
  syncDocumentStatus();
}

export { syncDocumentStatus };


