/**
 * 기존 업로드 API - 새로운 API로 직접 전달
 * 기존 클라이언트와의 호환성을 위해 유지
 */

import { NextRequest, NextResponse } from 'next/server';

// Vercel에서 API 라우트가 올바르게 인식되도록 런타임 설정
export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 새로운 API로 직접 전달 (리다이렉트 대신)
export async function POST(request: NextRequest) {
  console.log('🔄 기존 API에서 새로운 API로 직접 전달');
  
  try {
    // 새로운 API 모듈 직접 호출
    const { POST: newPost } = await import('../upload-new/route');
    return await newPost(request);
  } catch (error) {
    console.error('❌ API 전달 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'API 전달 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  console.log('🔄 기존 API에서 새로운 API로 직접 전달 (GET)');
  
  try {
    const { GET: newGet } = await import('../upload-new/route');
    return await newGet(request);
  } catch (error) {
    console.error('❌ API 전달 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'API 전달 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  console.log('🔄 기존 API에서 새로운 API로 직접 전달 (DELETE)');
  
  try {
    const { DELETE: newDelete } = await import('../upload-new/route');
    return await newDelete(request);
  } catch (error) {
    console.error('❌ API 전달 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'API 전달 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  console.log('🔄 기존 API에서 새로운 API로 직접 전달 (PUT)');
  
  try {
    const { PUT: newPut } = await import('../upload-new/route');
    return await newPut(request);
  } catch (error) {
    console.error('❌ API 전달 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'API 전달 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}