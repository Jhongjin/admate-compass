import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Integration test endpoint is available',
    timestamp: new Date().toISOString(),
    status: 'healthy'
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    return NextResponse.json({
      success: true,
      message: 'Integration test completed successfully',
      timestamp: new Date().toISOString(),
      receivedData: body,
      status: 'healthy'
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: 'Integration test failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      status: 'error'
    }, { status: 500 });
  }
}

