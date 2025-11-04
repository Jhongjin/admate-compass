import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';

/**
 * DOCX 파일에서 텍스트 추출 API
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

    if (!file.name.toLowerCase().endsWith('.docx')) {
      return NextResponse.json(
        { error: 'DOCX 파일이 아닙니다.' },
        { status: 400 }
      );
    }

    console.log(`📄 DOCX 텍스트 추출 시작: ${file.name} (${file.size} bytes)`);

    // 파일 크기 제한 및 타임아웃 설정
    const MAX_DOCX_SIZE = 10 * 1024 * 1024; // 10MB
    const TIMEOUT_MS = 30000; // 30s

    if (file.size > MAX_DOCX_SIZE) {
      return NextResponse.json(
        {
          success: false,
          queued: true,
          error: `파일이 너무 큽니다. 최대 ${Math.round(MAX_DOCX_SIZE/1024/1024)}MB까지 지원됩니다. 큐로 처리해주세요.`,
        },
        { status: 202 }
      );
    }

    // 파일을 ArrayBuffer로 변환
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // DOCX에서 텍스트 추출 + 타임아웃
    const extractPromise = mammoth.extractRawText({ buffer });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Extraction timeout')), TIMEOUT_MS));
    const result: any = await Promise.race([extractPromise, timeoutPromise]);
    
    console.log(`✅ DOCX 텍스트 추출 완료: ${result.value.length}자`);

    return NextResponse.json({
      success: true,
      text: result.value,
      messages: result.messages
    });

  } catch (error) {
    console.error('❌ DOCX 추출 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'DOCX 텍스트 추출 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
