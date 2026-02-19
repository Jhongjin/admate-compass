import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    console.log('🔍 Upload Test API - POST 요청 수신');
    
    const contentType = request.headers.get('content-type');
    console.log('📋 Content-Type:', contentType);
    
    if (contentType?.includes('multipart/form-data')) {
      console.log('📁 FormData 처리 시작');
      
      const formData = await request.formData();
      const file = formData.get('file') as File;
      const type = formData.get('type') as string;
      
      console.log('파일 정보:', {
        name: file?.name,
        size: file?.size,
        type: file?.type,
        uploadType: type
      });
      
      if (!file) {
        return NextResponse.json(
          { error: '파일이 제공되지 않았습니다.' },
          { status: 400 }
        );
      }
      
      return NextResponse.json({
        success: true,
        message: '파일이 성공적으로 수신되었습니다!',
        data: {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          uploadType: type,
          timestamp: new Date().toISOString()
        }
      });
      
    } else {
      return NextResponse.json(
        { error: 'multipart/form-data가 필요합니다.', receivedType: contentType },
        { status: 400 }
      );
    }
    
  } catch (error) {
    console.error('❌ Upload Test API 오류:', error);
    return NextResponse.json(
      { 
        error: '서버 내부 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Upload Test API가 정상적으로 작동합니다!',
    timestamp: new Date().toISOString()
  });
}
