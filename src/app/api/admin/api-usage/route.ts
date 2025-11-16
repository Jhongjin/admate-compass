import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('🚀 API 사용량 통계 조회 시작...');

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '30d'; // 7d, 30d, 90d, all

    // 기간 계산
    let startDate: Date;
    const endDate = new Date();
    
    switch (period) {
      case '7d':
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        break;
      default:
        startDate = new Date(0); // 모든 데이터
    }

    // 전체 통계 조회
    const { data: allLogs, error: logsError } = await supabase
      .from('api_usage_logs')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false });

    if (logsError) {
      console.error('❌ API 사용량 로그 조회 오류:', logsError);
      throw logsError;
    }

    // 일별 통계 조회 (RPC 함수 사용)
    const { data: dailyStats, error: dailyError } = await supabase
      .rpc('get_daily_api_usage', {
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      });

    if (dailyError) {
      console.error('❌ 일별 통계 조회 오류:', dailyError);
    }

    // 월별 통계 조회
    const monthsBack = period === '7d' ? 1 : period === '30d' ? 3 : period === '90d' ? 6 : 12;
    const { data: monthlyStats, error: monthlyError } = await supabase
      .rpc('get_monthly_api_usage', {
        months_back: monthsBack
      });

    if (monthlyError) {
      console.error('❌ 월별 통계 조회 오류:', monthlyError);
    }

    // 통계 계산
    const totalLogs = allLogs?.length || 0;
    const claudeLogs = allLogs?.filter(log => log.provider === 'claude') || [];
    const gptLogs = allLogs?.filter(log => log.provider === 'gpt') || [];

    const claudeStats = {
      totalRequests: claudeLogs.length,
      totalInputTokens: claudeLogs.reduce((sum, log) => sum + (log.input_tokens || 0), 0),
      totalOutputTokens: claudeLogs.reduce((sum, log) => sum + (log.output_tokens || 0), 0),
      totalTokens: claudeLogs.reduce((sum, log) => sum + (log.total_tokens || 0), 0),
      totalCost: claudeLogs.reduce((sum, log) => sum + (Number(log.cost_usd) || 0), 0)
    };

    const gptStats = {
      totalRequests: gptLogs.length,
      totalInputTokens: gptLogs.reduce((sum, log) => sum + (log.input_tokens || 0), 0),
      totalOutputTokens: gptLogs.reduce((sum, log) => sum + (log.output_tokens || 0), 0),
      totalTokens: gptLogs.reduce((sum, log) => sum + (log.total_tokens || 0), 0),
      totalCost: gptLogs.reduce((sum, log) => sum + (Number(log.cost_usd) || 0), 0)
    };

    const overallStats = {
      totalRequests: totalLogs,
      totalInputTokens: claudeStats.totalInputTokens + gptStats.totalInputTokens,
      totalOutputTokens: claudeStats.totalOutputTokens + gptStats.totalOutputTokens,
      totalTokens: claudeStats.totalTokens + gptStats.totalTokens,
      totalCost: claudeStats.totalCost + gptStats.totalCost
    };

    const response = NextResponse.json({
      success: true,
      data: {
        period,
        overall: overallStats,
        claude: claudeStats,
        gpt: gptStats,
        daily: dailyStats || [],
        monthly: monthlyStats || [],
        recentLogs: allLogs?.slice(0, 50) || [] // 최근 50개 로그
      }
    });

    response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');

    return response;

  } catch (error) {
    console.error('❌ API 사용량 통계 조회 오류:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'API 사용량 통계 조회 중 오류가 발생했습니다.',
      data: {
        period: '30d',
        overall: {
          totalRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalCost: 0
        },
        claude: {
          totalRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalCost: 0
        },
        gpt: {
          totalRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalCost: 0
        },
        daily: [],
        monthly: [],
        recentLogs: []
      }
    }, { status: 500 });
  }
}




