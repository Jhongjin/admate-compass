import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// 환경 변수에서 설정 가져오기
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 빌드 시에는 환경 변수가 없을 수 있으므로 조건부 처리
let supabase: any = null;

if (supabaseUrl && supabaseServiceKey) {
  supabase = createClient(supabaseUrl, supabaseServiceKey);
}

// 피드백 통계 조회 API
export async function GET(request: NextRequest) {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: '서비스가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '7'; // 기본 7일
    const days = parseInt(period);

    // 전체 피드백 통계
    const { data: totalStats, error: totalError } = await supabase
      .from('feedback')
      .select('helpful, created_at');

    if (totalError) {
      console.error('전체 피드백 통계 조회 오류:', totalError);
      
      // 테이블이 존재하지 않는 경우 기본값 반환
      if (totalError.code === 'PGRST205' || totalError.message?.includes('Could not find the table')) {
        console.warn('feedback 테이블이 존재하지 않습니다. 기본 통계를 반환합니다.');
        return NextResponse.json({
          success: true,
          stats: {
            total: 0,
            positive: 0,
            negative: 0,
            positivePercentage: 0,
            dailyStats: [],
            recentFeedback: []
          },
          message: 'feedback 테이블이 아직 생성되지 않았습니다.'
        });
      }
      
      return NextResponse.json(
        { error: '피드백 통계를 조회하는 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

    // 통계 계산
    const total = totalStats?.length || 0;
    const positive = totalStats?.filter((f: any) => f.helpful === true).length || 0;
    const negative = totalStats?.filter((f: any) => f.helpful === false).length || 0;
    const positivePercentage = total > 0 ? Math.round((positive / total) * 100) : 0;

    // 최근 N일간 일별 통계
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const dailyStats = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayStats = totalStats?.filter((f: any) => {
        const feedbackDate = new Date(f.created_at).toISOString().split('T')[0];
        return feedbackDate === dateStr;
      }) || [];
      
      dailyStats.push({
        date: dateStr,
        total: dayStats.length,
        positive: dayStats.filter((f: any) => f.helpful === true).length,
        negative: dayStats.filter((f: any) => f.helpful === false).length
      });
    }

    // 최근 피드백 조회 (최근 10개)
    const { data: recentFeedback, error: recentError } = await supabase
      .from('feedback')
      .select(`
        *,
        conversations!inner(user_message, ai_response)
      `)
      .order('created_at', { ascending: false })
      .limit(10);

    if (recentError) {
      console.warn('최근 피드백 조회 실패:', recentError);
    }

    return NextResponse.json({
      success: true,
      stats: {
        total,
        positive,
        negative,
        positivePercentage,
        dailyStats,
        recentFeedback: recentFeedback || []
      }
    });

  } catch (error) {
    console.error('피드백 통계 API 오류:', error);
    return NextResponse.json(
      { error: '피드백 통계 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
