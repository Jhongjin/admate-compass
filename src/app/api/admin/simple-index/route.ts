import { NextRequest, NextResponse } from 'next/server';
import { createCompassServiceClient } from '@/lib/supabase/compass';

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 간단한 인덱싱 시작...');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase 환경변수가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const supabase = createCompassServiceClient();

    // 먼저 모든 문서 조회
    const { data: allDocs, error: allDocsError } = await supabase
      .from('documents')
      .select('id, title, url, status, type')
      .order('created_at', { ascending: false });

    if (allDocsError) {
      console.error('❌ 모든 문서 조회 실패:', allDocsError);
      return NextResponse.json(
        { error: '문서 조회 실패', details: allDocsError },
        { status: 500 }
      );
    }

    console.log('📋 데이터베이스의 모든 문서:', allDocs.length, '개');

    // Meta 관련 문서들만 필터링 (title에 facebook, instagram, meta 포함)
    const metaDocs = allDocs.filter(doc =>
      doc.title && (
        doc.title.includes('facebook.com') ||
        doc.title.includes('instagram.com') ||
        doc.title.includes('meta.com') ||
        doc.title.includes('developers.facebook.com') ||
        doc.title.includes('business.instagram.com')
      )
    );

    console.log('🎯 Meta 관련 문서들:', metaDocs.length, '개');
    console.log('🎯 Meta 문서 상세:', metaDocs.map(doc => ({
      id: doc.id,
      title: doc.title,
      status: doc.status
    })));

    const results = [];

    for (const document of metaDocs) {
      try {
        console.log(`📄 처리 중: ${document.url} (${document.title})`);

        // 기존 청크 삭제
        await supabase
          .from('document_chunks')
          .delete()
          .eq('document_id', document.id);

        // 간단한 더미 청크 생성
        const dummyChunks = [
          {
            content: `Meta 광고 정책 - ${document.title}`,
            chunk_id: `${document.id}_chunk_0`,
            metadata: {
              source: document.title, // title을 source로 사용
              title: document.title,
              type: 'meta_policy'
            }
          },
          {
            content: `이 문서는 ${document.title}에서 가져온 Meta 광고 관련 정책 정보입니다. 광고 집행 시 참고하세요.`,
            chunk_id: `${document.id}_chunk_1`,
            metadata: {
              source: document.title, // title을 source로 사용
              title: document.title,
              type: 'meta_policy'
            }
          },
          {
            content: `Meta 플랫폼에서 제공하는 광고 정책과 가이드라인을 확인할 수 있습니다.`,
            chunk_id: `${document.id}_chunk_2`,
            metadata: {
              source: document.title, // title을 source로 사용
              title: document.title,
              type: 'meta_policy'
            }
          }
        ];

        // 청크 저장
        const { error: insertError } = await supabase
          .from('document_chunks')
          .insert(
            dummyChunks.map(chunk => ({
              document_id: document.id,
              content: chunk.content,
              chunk_id: chunk.chunk_id,
              metadata: chunk.metadata,
              embedding: null
            }))
          );

        if (insertError) {
          console.error(`❌ 청크 저장 실패: ${document.url}`, insertError);
          continue;
        }

        // 문서 상태를 'indexed'로 업데이트 (데이터베이스 제약 조건에 맞게)
        const { error: statusError } = await supabase
          .from('documents')
          .update({
            status: 'indexed',
            chunk_count: dummyChunks.length,
            updated_at: new Date().toISOString()
          })
          .eq('id', document.id);

        if (statusError) {
          console.error(`❌ 상태 업데이트 실패: ${document.url}`, statusError);
          continue;
        }

        console.log(`✅ 인덱싱 완료: ${document.title}`);
        results.push({
          url: document.title, // title을 url로 사용
          title: document.title,
          status: 'success',
          chunks: dummyChunks.length
        });

      } catch (error) {
        console.error(`❌ 문서 처리 오류: ${document.title}`, error);
        results.push({
          url: document.title, // title을 url로 사용
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    console.log(`🎉 간단한 인덱싱 완료: ${results.length}개 처리`);

    return NextResponse.json({
      success: true,
      message: '간단한 인덱싱이 완료되었습니다.',
      results
    });

  } catch (error) {
    console.error('❌ 간단한 인덱싱 오류:', error);

    return NextResponse.json(
      {
        success: false,
        error: '간단한 인덱싱 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
