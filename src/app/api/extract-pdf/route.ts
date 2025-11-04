import { NextRequest, NextResponse } from 'next/server';

/**
 * PDF 파일에서 텍스트 추출 API
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: '파일이 제공되지 않았습니다.' },
        { status: 400 }
      );
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json(
        { error: 'PDF 파일이 아닙니다.' },
        { status: 400 }
      );
    }

    console.log(`📄 PDF 텍스트 추출 시작: ${file.name} (${file.size} bytes)`);

    // 파일 크기 제한 및 타임아웃 설정
    const MAX_PDF_SIZE = 5 * 1024 * 1024; // 5MB
    const TIMEOUT_MS = 25000; // 25s

    if (file.size > MAX_PDF_SIZE) {
      return NextResponse.json(
        {
          success: false,
          queued: true,
          error: `파일이 너무 큽니다. 최대 ${Math.round(MAX_PDF_SIZE/1024/1024)}MB까지 지원됩니다. 큐로 처리해주세요.`,
        },
        { status: 202 }
      );
    }

    // 파일을 ArrayBuffer로 변환
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // PDF에서 텍스트 추출 (동적 import) + 타임아웃
    const pdfPromise = (async () => {
      const pdf = (await import('pdf-parse')).default;
      return await pdf(buffer);
    })();

    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Extraction timeout')), TIMEOUT_MS));
    const pdfData: any = await Promise.race([pdfPromise, timeoutPromise]);

    console.log(`✅ PDF 텍스트 추출 완료: ${pdfData.text.length}자`);

    return NextResponse.json({
      success: true,
      text: pdfData.text,
      pages: pdfData.numpages,
      info: pdfData.info
    });

  } catch (error) {
    console.error('❌ PDF 추출 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'PDF 텍스트 추출 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
