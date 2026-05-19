import { NextResponse } from 'next/server';
import { guardProductionAdminDebugRoute } from '@/lib/adminDebugGuard';

export async function GET() {
  const guardResponse = guardProductionAdminDebugRoute();
  if (guardResponse) return guardResponse;

  try {
    console.log('🚂 Managed answer service status check started');
    
    const railwayUrl = process.env.RAILWAY_OLLAMA_URL || 'https://meta-faq-ollama-production.up.railway.app';
    console.log('🔗 Managed answer service configuration:', {
      runtimeConfigured: Boolean(process.env.RAILWAY_OLLAMA_URL),
      usingDefaultRuntime: !process.env.RAILWAY_OLLAMA_URL,
    });
    
    // Managed answer service 서버 상태 확인
    const response = await fetch(`${railwayUrl}/api/tags`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Meta-FAQ-Chatbot/1.0'
      },
      signal: AbortSignal.timeout(10000) // 10초 타임아웃
    });
    
    console.log('📡 Managed answer service response status:', response.status);
    
    if (!response.ok) {
      throw new Error(`Managed answer service response error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✅ Managed answer service status check succeeded:', {
      modelsCount: Array.isArray(data.models) ? data.models.length : 0,
    });
    
    return NextResponse.json({
      healthy: true,
      runtimeConfigured: Boolean(process.env.RAILWAY_OLLAMA_URL),
      runtimeReachable: true,
      models: data.models || [],
      message: 'Compass answer service is operational'
    });
    
  } catch (error) {
    console.error('❌ Managed answer service status check failed:', error);
    
    return NextResponse.json({
      healthy: false,
      runtimeConfigured: Boolean(process.env.RAILWAY_OLLAMA_URL),
      runtimeReachable: false,
      models: [],
      message: 'Compass answer service is currently unavailable',
      error: 'Managed answer service status check failed'
    }, { status: 500 });
  }
}
