import { NextRequest, NextResponse } from 'next/server';
import { createCompassServiceClient } from '@/lib/supabase/compass';

export async function POST(request: NextRequest) {
  try {
    // Supabase 클라이언트 생성
    const supabase = createCompassServiceClient();

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

    const results = [];

    for (const doc of documents || []) {
      console.log(`문서 ID: ${doc.id}`);
      console.log(`제목: ${doc.title}`);
      console.log(`현재 상태: ${doc.status}`);
      console.log(`청크 수: ${doc.chunk_count}`);

      // 청크가 있는지 확인
      const { data: chunks, error: chunksError } = await supabase
        .from('document_chunks')
        .select('id')
        .eq('document_id', doc.id);

      if (chunksError) {
        console.error(`청크 조회 실패 (${doc.id}):`, chunksError);
        results.push({
          documentId: doc.id,
          title: doc.title,
          status: 'error',
          message: `청크 조회 실패: ${chunksError.message}`
        });
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
          results.push({
            documentId: doc.id,
            title: doc.title,
            status: 'error',
            message: `업데이트 실패: ${updateError.message}`
          });
        } else {
          console.log(`문서 상태 업데이트 완료: ${doc.id} -> ${newStatus} (${chunkCount} 청크)`);
          results.push({
            documentId: doc.id,
            title: doc.title,
            status: 'updated',
            message: `상태 업데이트: ${doc.status} -> ${newStatus}, 청크 수: ${doc.chunk_count} -> ${chunkCount}`
          });
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
          results.push({
            documentId: doc.id,
            title: doc.title,
            status: 'error',
            message: `상태 업데이트 실패: ${updateError.message}`
          });
        } else {
          console.log(`문서 상태 업데이트 완료: ${doc.id} -> indexed`);
          results.push({
            documentId: doc.id,
            title: doc.title,
            status: 'updated',
            message: `상태 업데이트: processing -> indexed`
          });
        }
      } else {
        results.push({
          documentId: doc.id,
          title: doc.title,
          status: 'no_change',
          message: `상태 변경 없음: ${doc.status} (${chunkCount} 청크)`
        });
      }
    }

    console.log('문서 상태 동기화 완료!');

    return NextResponse.json({
      success: true,
      message: '문서 상태 동기화가 완료되었습니다.',
      data: {
        totalDocuments: documents?.length || 0,
        results: results
      }
    });

  } catch (error) {
    console.error('동기화 오류:', error);

    // 환경 변수 관련 에러인 경우 특별 처리
    if (error instanceof Error && error.message.includes('환경 변수')) {
      return NextResponse.json(
        {
          error: '데이터베이스 연결 설정 오류',
          details: 'Supabase 환경 변수가 올바르게 설정되지 않았습니다.'
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: '문서 상태 동기화 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}


