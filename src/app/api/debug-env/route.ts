import { NextRequest, NextResponse } from 'next/server';
import { getOllamaEndpointStatus } from '@/lib/services/ollamaEndpoint';

export async function GET() {
  try {
    console.log('🔍 환경변수 디버깅 시작');
    
    // 환경변수 확인 (값은 마스킹)
    const envStatus = {
      NEXT_PUBLIC_SUPABASE_URL: {
        exists: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        length: process.env.NEXT_PUBLIC_SUPABASE_URL?.length || 0,
        prefix: process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 20) + '...' || 'undefined'
      },
      SUPABASE_SERVICE_ROLE_KEY: {
        exists: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        length: process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0,
        prefix: process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20) + '...' || 'undefined'
      },
      OLLAMA_BASE_URL: {
        exists: !!process.env.OLLAMA_BASE_URL,
        length: process.env.OLLAMA_BASE_URL?.length || 0
      },
      VULTR_OLLAMA_URL: {
        exists: !!process.env.VULTR_OLLAMA_URL,
        length: process.env.VULTR_OLLAMA_URL?.length || 0
      },
      OLLAMA_DEFAULT_MODEL: {
        exists: !!process.env.OLLAMA_DEFAULT_MODEL,
        length: process.env.OLLAMA_DEFAULT_MODEL?.length || 0
      },
      OLLAMA_ENDPOINT: getOllamaEndpointStatus(),
      NODE_ENV: process.env.NODE_ENV
    };
    
    console.log('📊 환경변수 상태:', envStatus);
    
    return NextResponse.json({
      success: true,
      envStatus,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ 환경변수 디버깅 실패:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
