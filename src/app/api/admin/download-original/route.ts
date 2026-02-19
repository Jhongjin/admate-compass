import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('documentId');
    
    if (!documentId) {
      return NextResponse.json(
        { error: '문서 ID가 필요합니다.' },
        { status: 400 }
      );
    }
    
    console.log(`📥 원본 파일 다운로드 요청: ${documentId}`);
    
    // 1. documents 테이블에서 문서 정보 조회
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
    
    console.log(`📄 문서 정보: ${document.title} (${document.type})`);
    
    // 2. 파일 타입 결정
    let actualFileType = 'txt';
    if (document.file_type) {
      if (document.file_type.includes('pdf')) {
        actualFileType = 'pdf';
      } else if (document.file_type.includes('docx') || document.file_type.includes('word')) {
        actualFileType = 'docx';
      } else if (document.file_type.includes('text')) {
        actualFileType = 'txt';
      }
    } else if (document.title) {
      const extension = document.title.split('.').pop()?.toLowerCase();
      if (extension === 'pdf') actualFileType = 'pdf';
      else if (extension === 'docx') actualFileType = 'docx';
      else if (extension === 'txt') actualFileType = 'txt';
    }
    
    console.log(`📁 파일 타입: ${actualFileType}`);
    
    // 3. 원본 바이너리 데이터 검색
    let originalFileData = null;
    let dataSource = '';
    
    // 3-1. document_metadata에서 fileData 검색
    try {
      const { data: metadataData, error: metadataError } = await supabase
        .from('document_metadata')
        .select('metadata')
        .eq('id', documentId)
        .single();
      
      if (!metadataError && metadataData?.metadata?.fileData) {
        originalFileData = metadataData.metadata.fileData;
        dataSource = 'document_metadata.metadata.fileData';
        console.log('✅ document_metadata에서 원본 fileData 발견');
      }
    } catch (error) {
      console.error('❌ document_metadata 조회 실패:', error);
    }
    
    // 3-2. documents.content에서 바이너리 데이터 검색
    if (!originalFileData && document.content) {
      // Base64 패턴 확인
      const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
      if (base64Pattern.test(document.content) && document.content.length > 100) {
        try {
          const testBuffer = Buffer.from(document.content, 'base64');
          const pdfSignature = testBuffer.toString('ascii', 0, 4);
          const docxSignature = testBuffer.toString('hex', 0, 4);
          
          if (pdfSignature === '%PDF' || docxSignature === '504b0304') {
            originalFileData = document.content;
            dataSource = 'documents.content (바이너리)';
            console.log('✅ documents.content에서 원본 바이너리 데이터 발견');
          }
        } catch (error) {
          console.log('📄 documents.content는 바이너리가 아님');
        }
      }
    }
    
    // 3-3. 원본 데이터가 없으면 추출된 텍스트 사용
    if (!originalFileData) {
      originalFileData = document.content;
      dataSource = 'documents.content (텍스트)';
      console.log('📄 documents.content 사용 (추출된 텍스트)');
    }
    
    console.log(`📊 데이터 소스: ${dataSource}`);
    
    // 4. 파일 버퍼 생성
    let fileBuffer: Buffer;
    
    if (dataSource.includes('바이너리')) {
      // 원본 바이너리 데이터 처리
      console.log('🔧 원본 바이너리 데이터 처리');
      
      if (originalFileData.startsWith('data:')) {
        const base64Data = originalFileData.split(',')[1];
        fileBuffer = Buffer.from(base64Data, 'base64');
        console.log('📄 Data URL Base64에서 파일 버퍼 생성');
      } else {
        fileBuffer = Buffer.from(originalFileData, 'base64');
        console.log(`📄 Base64 바이너리 디코딩: ${fileBuffer.length} bytes`);
      }
    } else {
      // 추출된 텍스트 데이터 처리
      console.log('🔧 추출된 텍스트 데이터 처리');
      
      if (originalFileData.startsWith('data:')) {
        const base64Data = originalFileData.split(',')[1];
        const textContent = Buffer.from(base64Data, 'base64').toString('utf-8');
        fileBuffer = Buffer.from(textContent, 'utf-8');
        console.log('📄 Data URL에서 텍스트 추출');
      } else {
        fileBuffer = Buffer.from(originalFileData, 'utf-8');
        console.log('📄 텍스트 데이터 처리');
      }
    }
    
    // 5. MIME 타입과 확장자 설정
    let mimeType = 'application/octet-stream';
    let extension = 'bin';
    
    if (dataSource.includes('바이너리')) {
      // 원본 바이너리 데이터인 경우 - 원본 파일 타입 유지
      if (actualFileType === 'pdf') {
        mimeType = 'application/pdf';
        extension = 'pdf';
        console.log('✅ PDF 원본 MIME 타입 설정: application/pdf');
      } else if (actualFileType === 'docx') {
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        extension = 'docx';
        console.log('✅ DOCX 원본 MIME 타입 설정: application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      }
    } else {
      // 추출된 텍스트 데이터인 경우 - TXT로 처리
      mimeType = 'text/plain; charset=utf-8';
      extension = 'txt';
      console.log('✅ 추출된 텍스트 MIME 타입 설정: text/plain');
    }
    
    // 6. 파일명 정리
    let cleanTitle = document.title;
    const existingExtensions = ['.pdf', '.docx', '.txt'];
    for (const ext of existingExtensions) {
      if (cleanTitle.toLowerCase().endsWith(ext)) {
        cleanTitle = cleanTitle.substring(0, cleanTitle.length - ext.length);
        break;
      }
    }
    
    const encodedFilename = encodeURIComponent(`${cleanTitle}.${extension}`);
    
    console.log(`✅ 원본 파일 다운로드 준비 완료: ${encodedFilename} (${fileBuffer.length} bytes, MIME: ${mimeType})`);
    
    return new NextResponse(fileBuffer as any, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
        'Content-Length': fileBuffer.length.toString()
      }
    });
    
  } catch (error) {
    console.error('❌ 다운로드 오류:', error);
    return NextResponse.json(
      { 
        error: '다운로드 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}


