import { NextRequest, NextResponse } from 'next/server';
import { createCompassServiceClient } from '@/lib/supabase/compass';
import { guardCompassProductAdminSessionRoute } from '@/lib/adminProductSessionGuard';

// 환경 변수 확인 및 조건부 클라이언트 생성
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: any = null;

if (supabaseUrl && supabaseKey) {
  supabase = createCompassServiceClient();
}

// 문서 다운로드
export async function GET(request: NextRequest) {
  const sessionGuard = guardCompassProductAdminSessionRoute(request);
  if (sessionGuard) return sessionGuard;

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
  return NextResponse.json(
    {
      success: false,
      code: 'DOCUMENT_ACTIONS_REINDEX_FAIL_CLOSED',
      error: '안전한 재인덱싱 경로가 아직 연결되지 않았습니다.',
      message: '기존 청크를 삭제하거나 상태만 완료 처리하지 않습니다. Source Ops 승인 경로, 실제 추출 파이프라인, 또는 공식 가이드 그래프 백필 경로를 사용하세요.',
      data: {
        documentId,
      },
    },
    { status: 409 },
  );
}
