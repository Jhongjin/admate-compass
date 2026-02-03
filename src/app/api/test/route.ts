import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ 
    success: true, 
    message: 'API 테스트 성공',
    timestamp: new Date().toISOString()
  });
}

export async function POST() {
  return NextResponse.json({ 
    success: true, 
    message: 'POST 테스트 성공',
    timestamp: new Date().toISOString()
  });
}