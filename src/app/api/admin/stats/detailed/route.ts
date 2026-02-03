import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('🚀 상세 통계 API 시작...');

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
    const period = searchParams.get('period') || '7d'; // 7d, 30d, 90d

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
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
    }

    // 1. 주간 활동 데이터 (요일별 질문 수 및 사용자 수)
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select('id, created_at, user_id')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false });

    if (convError) {
      console.error('❌ 대화 조회 오류:', convError);
    }

    // 요일별 통계 계산
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const userActivity = dayNames.map((dayName, dayIndex) => {
      const dayConversations = conversations?.filter(conv => {
        const date = new Date(conv.created_at);
        return date.getDay() === dayIndex;
      }) || [];
      
      const uniqueUsers = new Set(dayConversations.map(c => c.user_id));
      
      return {
        date: dayName,
        questions: dayConversations.length,
        users: uniqueUsers.size
      };
    });

    // 2. 인기 질문 (메시지 테이블에서 user_message 기반)
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('content, created_at, role, conversation_id')
      .eq('role', 'user')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false });

    if (messagesError) {
      console.error('❌ 메시지 조회 오류:', messagesError);
    }

    // 질문별 카운트 계산 (간단한 키워드 기반)
    const questionCounts = new Map<string, number>();
    messages?.forEach(msg => {
      const content = msg.content || '';
      // 질문의 첫 50자를 키로 사용 (유사한 질문 그룹화)
      const key = content.substring(0, 50).trim();
      if (key.length > 5) { // 최소 길이 체크
        questionCounts.set(key, (questionCounts.get(key) || 0) + 1);
      }
    });

    // 상위 3개 질문 추출
    const topQuestions = Array.from(questionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([question, count], index) => ({
        question: question.length > 40 ? question.substring(0, 40) + '...' : question,
        count,
        change: 0 // 이전 기간 대비 변화율은 별도 계산 필요
      }));

    // 3. 팀별 사용자 세그먼트 통계
    const { data: teamStats, error: teamStatsError } = await supabase
      .rpc('get_team_user_stats');

    if (teamStatsError) {
      console.error('❌ 팀별 통계 조회 오류:', teamStatsError);
    }

    const { data: teamQuestionStats, error: teamQuestionStatsError } = await supabase
      .rpc('get_team_question_stats');

    if (teamQuestionStatsError) {
      console.error('❌ 팀별 질문 통계 조회 오류:', teamQuestionStatsError);
    }

    // 팀별 만족도 계산 (피드백 기반)
    const { data: feedback, error: feedbackError } = await supabase
      .from('feedback')
      .select('id, helpful, created_at, conversation_id')
      .gte('created_at', startDate.toISOString());

    if (feedbackError) {
      console.error('❌ 피드백 조회 오류:', feedbackError);
    }

    // 팀별 만족도 계산을 위해 conversations와 profiles 조인 필요
    const userSegments = (teamStats || []).map((team: any) => {
      const teamQuestions = teamQuestionStats?.find((tq: any) => tq.team === team.team);
      const helpfulCount = feedback?.filter((fb: any) => fb.helpful === true).length || 0;
      const totalFeedback = feedback?.length || 0;
      const satisfaction = totalFeedback > 0 
        ? Math.round((helpfulCount / totalFeedback) * 100) 
        : 0;

      return {
        segment: team.team || '미지정',
        users: team.user_count || 0,
        questions: teamQuestions?.question_count || 0,
        satisfaction
      };
    }).slice(0, 3); // 상위 3개만

    // 4. 문서 통계 (타입별)
    const { data: documents, error: docsError } = await supabase
      .from('documents')
      .select('id, type, status, file_size');

    if (docsError) {
      console.error('❌ 문서 조회 오류:', docsError);
    }

    const documentStatsByType = new Map<string, { count: number; size: number; indexed: number }>();
    documents?.forEach(doc => {
      const type = doc.type || 'unknown';
      const current = documentStatsByType.get(type) || { count: 0, size: 0, indexed: 0 };
      current.count += 1;
      current.size += doc.file_size || 0;
      if (doc.status === 'indexed' || doc.status === 'completed') {
        current.indexed += 1;
      }
      documentStatsByType.set(type, current);
    });

    const documentStats = Array.from(documentStatsByType.entries())
      .map(([type, stats]) => ({
        type: type.toUpperCase(),
        count: stats.count,
        size: `${(stats.size / 1024 / 1024).toFixed(1)} MB`,
        indexed: stats.indexed
      }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      success: true,
      data: {
        userActivity,
        topQuestions,
        userSegments,
        documentStats
      }
    });

  } catch (error) {
    console.error('❌ 상세 통계 API 오류:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '상세 통계 조회 중 오류가 발생했습니다.',
      data: {
        userActivity: [],
        topQuestions: [],
        userSegments: [],
        documentStats: []
      }
    }, { status: 500 });
  }
}


