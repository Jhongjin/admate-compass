import { NextRequest, NextResponse } from 'next/server';

/**
 * TXT 파일에서 텍스트 추출 API
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

    if (!file.name.toLowerCase().endsWith('.txt')) {
      return NextResponse.json(
        { error: 'TXT 파일이 아닙니다.' },
        { status: 400 }
      );
    }

    console.log(`📄 TXT 텍스트 추출 시작: ${file.name} (${file.size} bytes)`);

    // TXT 파일에서 텍스트 추출
    const text = await file.text();
    
    console.log(`✅ TXT 텍스트 추출 완료: ${text.length}자`);

    return NextResponse.json({
      success: true,
      text: text,
      size: file.size
    });

  } catch (error) {
    console.error('❌ TXT 추출 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'TXT 텍스트 추출 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
