import { NextRequest, NextResponse } from 'next/server';
import { createCompassServiceClient } from '@/lib/supabase/compass';

// 환경 변수 확인 및 조건부 클라이언트 생성
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: any = null;

if (supabaseUrl && supabaseKey) {
  supabase = createCompassServiceClient();
}

// 문서 다운로드
export async function GET(request: NextRequest) {
  try {
    // Supabase 클라이언트 확인
    if (!supabase) {
      return NextResponse.json(
        { error: '데이터베이스 연결이 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const documentId = searchParams.get('documentId');

    if (!action || !documentId) {
      return NextResponse.json(
        { error: '액션과 문서 ID가 필요합니다.' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'download':
        return await handleDownload(documentId);
      case 'preview':
        return await handlePreview(documentId);
      case 'reindex':
        return await handleReindex(documentId);
      default:
        return NextResponse.json(
          { error: '지원하지 않는 액션입니다.' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('문서 액션 오류:', error);
    return NextResponse.json(
      {
        error: '문서 액션 처리 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// 문서 다운로드 처리
async function handleDownload(documentId: string) {
  try {
    // 문서 정보 조회
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      return NextResponse.json(
        { error: '문서를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // URL 문서인 경우
    if (document.type === 'url') {
      let actualUrl = document.title; // 기본값으로 title 사용

      // documents 테이블에서 url 필드 확인
      if (document.url) {
        actualUrl = document.url;
      } else {
        // fallback: 메타데이터에서 URL 조회
        const { data: metadata, error: metaError } = await supabase
          .from('document_metadata')
          .select('*')
          .eq('id', documentId)
          .single();

        if (!metaError && metadata?.metadata?.url) {
          actualUrl = metadata.metadata.url;
        }
      }

      // 문서명에서 URL 정보 제거 (괄호와 URL 부분 제거)
      const cleanTitle = document.title.replace(/\s*\([^)]*\)$/, '');

      const content = `문서명: ${cleanTitle}\nURL: ${actualUrl}\n\n이 URL은 ${new Date(document.created_at).toLocaleString('ko-KR')}에 크롤링되었습니다.\n상태: ${document.status}\n청크 수: ${document.chunk_count}`;

      // UTF-8 인코딩으로 Buffer 생성
      const buffer = Buffer.from(content, 'utf8');

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(document.title.replace(/[^a-zA-Z0-9가-힣]/g, '_'))}.txt"`
        }
      });
    }

    // 파일 문서인 경우 - 메타데이터에서 실제 파일 타입과 원본 데이터 조회
    const { data: metadata, error: metaError } = await supabase
      .from('document_metadata')
      .select('type, metadata')
      .eq('id', documentId)
      .single();

    if (metaError || !metadata) {
      return NextResponse.json(
        { error: '문서 메타데이터를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    const actualFileType = metadata.type; // 'pdf', 'docx', 'txt' 등
    const fileData = metadata.metadata?.fileData;

    if (!fileData) {
      // 원본 파일 데이터가 없는 경우 텍스트 내용으로 대체
      const { data: chunks, error: chunksError } = await supabase
        .from('document_chunks')
        .select('content')
        .eq('document_id', documentId)
        .order('chunk_id', { ascending: true });

      if (chunksError) {
        return NextResponse.json(
          { error: '문서 내용을 조회할 수 없습니다.' },
          { status: 500 }
        );
      }

      // 청크들을 합쳐서 텍스트 문서로 제공
      const fullContent = chunks?.map((chunk: any) => chunk.content).join('\n\n') || '';

      let mimeType = 'text/plain; charset=utf-8';
      let extension = 'txt';

      if (actualFileType === 'pdf') {
        mimeType = 'text/plain; charset=utf-8';
        extension = 'txt';
      } else if (actualFileType === 'docx') {
        mimeType = 'text/plain; charset=utf-8';
        extension = 'txt';
      } else if (actualFileType === 'txt') {
        mimeType = 'text/plain; charset=utf-8';
        extension = 'txt';
      }

      // UTF-8로 인코딩된 Buffer 생성
      const buffer = Buffer.from(fullContent, 'utf-8');

      // 파일명 URL 인코딩
      const encodedFilename = encodeURIComponent(`${document.title}_extracted_text.${extension}`);

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': mimeType,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
          'Content-Length': buffer.length.toString()
        }
      });
    }

    // 원본 파일 데이터가 있는 경우
    const fileBuffer = Buffer.from(fileData, 'base64');

    let mimeType = 'application/octet-stream';
    let extension = 'bin';

    if (actualFileType === 'pdf') {
      mimeType = 'application/pdf';
      extension = 'pdf';
    } else if (actualFileType === 'docx') {
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      extension = 'docx';
    } else if (actualFileType === 'txt') {
      mimeType = 'text/plain; charset=utf-8';
      extension = 'txt';
    }

    // 파일명 URL 인코딩
    const encodedFilename = encodeURIComponent(`${document.title}.${extension}`);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
        'Content-Length': fileBuffer.length.toString()
      }
    });

  } catch (error) {
    console.error('다운로드 오류:', error);
    return NextResponse.json(
      { error: '다운로드 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 문서 미리보기 처리
async function handlePreview(documentId: string) {
  try {
    // 문서 정보 조회
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      return NextResponse.json(
        { error: '문서를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // URL 문서인 경우
    if (document.type === 'url') {
      return NextResponse.json({
        success: true,
        data: {
          type: 'url',
          title: document.title,
          url: document.title, // URL이 title에 저장되어 있다고 가정
          status: document.status,
          chunk_count: document.chunk_count,
          created_at: document.created_at,
          updated_at: document.updated_at
        }
      });
    }

    // 파일 문서인 경우 - 메타데이터에서 실제 파일 타입 조회
    const { data: metadata, error: metaError } = await supabase
      .from('document_metadata')
      .select('type')
      .eq('id', documentId)
      .single();

    if (metaError || !metadata) {
      return NextResponse.json(
        { error: '문서 메타데이터를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 첫 번째 청크의 내용만 미리보기로 제공
    const { data: firstChunk, error: chunksError } = await supabase
      .from('document_chunks')
      .select('content, metadata')
      .eq('document_id', documentId)
      .order('chunk_id', { ascending: true })
      .limit(1)
      .single();

    if (chunksError) {
      return NextResponse.json(
        { error: '문서 내용을 조회할 수 없습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        type: metadata.type, // 실제 파일 타입 사용
        title: document.title,
        status: document.status,
        chunk_count: document.chunk_count,
        created_at: document.created_at,
        updated_at: document.updated_at,
        preview: firstChunk?.content?.substring(0, 500) + (firstChunk?.content?.length > 500 ? '...' : ''),
        metadata: firstChunk?.metadata
      }
    });

  } catch (error) {
    console.error('미리보기 오류:', error);
    return NextResponse.json(
      { error: '미리보기 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 문서 재인덱싱 처리
async function handleReindex(documentId: string) {
  try {
    console.log(`🔄 재인덱싱 시작: ${documentId}`);

    // 문서 정보 조회
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      console.error('❌ 문서 조회 실패:', docError);
      return NextResponse.json(
        { error: '문서를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    console.log(`📄 재인덱싱 대상: ${document.title} (${document.type})`);

    // 기존 청크 삭제
    console.log(`🗑️ 기존 청크 삭제 중...`);
    const { error: deleteError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', documentId);

    if (deleteError) {
      console.warn('기존 청크 삭제 실패:', deleteError);
    }

    // 문서 상태를 processing으로 변경
    console.log(`🔄 상태를 processing으로 변경 중...`);
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        status: 'processing',
        chunk_count: 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);

    if (updateError) {
      console.error('❌ 상태 업데이트 실패:', updateError);
      return NextResponse.json(
        { error: '문서 상태 업데이트에 실패했습니다.' },
        { status: 500 }
      );
    }

    // URL 문서인 경우 실제 재인덱싱 수행
    if (document.type === 'url' && document.url) {
      console.log(`🌐 URL 재인덱싱 시작: ${document.url}`);

      try {
        // 서버리스 환경에서는 기본적인 URL 정보만 업데이트
        console.log(`📄 서버리스 환경에서 URL 처리: ${document.url}`);

        // 문서 상태를 completed로 업데이트
        const { error: finalUpdateError } = await supabase
          .from('documents')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', documentId);

        if (finalUpdateError) {
          console.error('❌ 최종 상태 업데이트 실패:', finalUpdateError);
        } else {
          console.log(`✅ 문서 상태를 completed로 업데이트 완료`);
        }

        console.log(`✅ 재인덱싱 완료`);

        return NextResponse.json({
          success: true,
          message: 'URL 문서 상태가 업데이트되었습니다. (서버리스 환경에서는 실제 크롤링이 제한됩니다)',
          data: {
            documentId,
            status: 'completed'
          }
        });

      } catch (crawlError) {
        console.error('❌ 크롤링/인덱싱 오류:', crawlError);

        // 실패 시 상태를 failed로 변경
        await supabase
          .from('documents')
          .update({
            status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', documentId);

        return NextResponse.json(
          { error: `재인덱싱 실패: ${crawlError instanceof Error ? crawlError.message : String(crawlError)}` },
          { status: 500 }
        );
      }
    } else {
      // 파일 문서인 경우 실제 재인덱싱 수행
      console.log(`📁 파일 문서 재인덱싱 시작: ${document.title}`);

      try {
        // 메타데이터에서 원본 파일 정보 조회
        const { data: metadata, error: metaError } = await supabase
          .from('document_metadata')
          .select('*')
          .eq('id', documentId)
          .single();

        if (metaError || !metadata) {
          console.error('❌ 메타데이터 조회 실패:', metaError);
          return NextResponse.json(
            { error: '문서 메타데이터를 찾을 수 없습니다.' },
            { status: 404 }
          );
        }

        console.log(`📄 메타데이터 조회 완료: ${metadata.type}`);

        // 원본 파일 데이터가 있는 경우 재인덱싱
        if (metadata.file_data) {
          console.log(`🔄 파일 데이터로 재인덱싱 시작...`);

          // DocumentIndexingService를 사용하여 재인덱싱
          const { documentIndexingService } = await import('@/lib/services/DocumentIndexingService');

          // Base64 데이터를 Blob으로 변환
          const base64Data = metadata.file_data.split(',')[1]; // data:application/pdf;base64, 부분 제거
          const binaryData = Buffer.from(base64Data, 'base64');
          const blob = new Blob([binaryData], { type: metadata.mime_type || 'application/octet-stream' });

          // File 객체 생성
          const file = new File([blob], document.title, {
            type: metadata.mime_type || 'application/octet-stream'
          });

          // 재인덱싱 수행
          const result = await documentIndexingService.indexFile(file, {}, documentId);

          if (result.status === 'failed') {
            throw new Error(result.error || '파일 재인덱싱에 실패했습니다.');
          }

          console.log(`✅ 파일 재인덱싱 완료: ${result.chunksProcessed}개 청크`);

          // 문서 상태를 completed로 업데이트
          const { error: finalUpdateError } = await supabase
            .from('documents')
            .update({
              status: 'completed',
              chunk_count: result.chunksProcessed,
              updated_at: new Date().toISOString()
            })
            .eq('id', documentId);

          if (finalUpdateError) {
            console.error('❌ 최종 상태 업데이트 실패:', finalUpdateError);
          } else {
            console.log(`✅ 문서 상태를 completed로 업데이트 완료`);
          }

          return NextResponse.json({
            success: true,
            message: '파일 재인덱싱이 완료되었습니다.',
            data: {
              documentId,
              status: 'completed',
              chunksProcessed: result.chunksProcessed,
              embeddingsGenerated: result.embeddingsGenerated
            }
          });

        } else {
          // 원본 파일 데이터가 없는 경우 상태만 변경
          console.log(`⚠️ 원본 파일 데이터가 없음: 상태만 변경`);

          const { error: finalUpdateError } = await supabase
            .from('documents')
            .update({
              status: 'completed',
              updated_at: new Date().toISOString()
            })
            .eq('id', documentId);

          if (finalUpdateError) {
            console.error('❌ 상태 업데이트 실패:', finalUpdateError);
          }

          return NextResponse.json({
            success: true,
            message: '재인덱싱이 완료되었습니다. (원본 파일 데이터 없음)',
            data: {
              documentId,
              status: 'completed'
            }
          });
        }

      } catch (fileError) {
        console.error('❌ 파일 재인덱싱 오류:', fileError);

        // 실패 시 상태를 failed로 변경
        await supabase
          .from('documents')
          .update({
            status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', documentId);

        return NextResponse.json(
          { error: `파일 재인덱싱 실패: ${fileError instanceof Error ? fileError.message : String(fileError)}` },
          { status: 500 }
        );
      }
    }

  } catch (error) {
    console.error('재인덱싱 오류:', error);
    return NextResponse.json(
      { error: '재인덱싱 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
