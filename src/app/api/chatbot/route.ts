import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('🚀 챗봇 통계 API 시작...');

    // Supabase 클라이언트 직접 생성
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    // 1. 실제 대화 통계 조회
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select('id, created_at, user_id');

    if (convError) {
      console.error('❌ 대화 조회 오류:', convError);
    }

    // 2. 실제 피드백 통계 조회
    const { data: feedback, error: feedbackError } = await supabase
      .from('feedback')
      .select('id, rating, created_at, helpful');

    if (feedbackError) {
      console.error('❌ 피드백 조회 오류:', feedbackError);
    }

    // 3. 실제 메시지 통계 조회
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('id, created_at, conversation_id, role');

    if (messagesError) {
      console.error('❌ 메시지 조회 오류:', messagesError);
    }

    // 실제 데이터 기반 통계 계산
    const totalQuestions = conversations?.length || 0;
    
    // 평균 응답 시간 계산 (실제 데이터가 없으면 null 반환)
    // conversations 테이블에 response_time 필드가 없으므로, 
    // 실제 응답 시간 데이터가 저장되면 그때 계산하도록 함
    // 현재는 데이터가 없으므로 null 반환 (fallback 값 사용 안 함)
    const averageResponseTime = null; // 실제 데이터가 없으면 null

    // 정확도 계산 (피드백 기반 - helpful 필드 사용)
    const helpfulFeedback = feedback?.filter(fb => fb.helpful === true).length || 0;
    const notHelpfulFeedback = feedback?.filter(fb => fb.helpful === false).length || 0;
    const totalFeedback = feedback?.length || 0;
    
    // 실제 피드백이 있으면 실제 값 사용, 없으면 null
    const accuracy = totalFeedback > 0 ? helpfulFeedback / totalFeedback : null;

    // 사용자 만족도 계산 (5점 만점 기준)
    // helpful 비율을 5점 만점으로 변환 (helpful 비율 * 4 + 1, 최소 1점)
    const userSatisfaction = totalFeedback > 0 
      ? (helpfulFeedback / totalFeedback) * 4 + 1 
      : null;

    // 일일 질문 수 계산 (최근 24시간)
    const oneDayAgo = new Date();
    oneDayAgo.setHours(oneDayAgo.getHours() - 24);
    
    const dailyQuestions = conversations?.filter(conv => 
      new Date(conv.created_at) >= oneDayAgo
    ).length || 0;

    const chatStats = {
      totalQuestions,
      averageResponseTime: averageResponseTime ? Math.round(averageResponseTime) : null,
      accuracy: accuracy !== null ? accuracy : null,
      userSatisfaction: userSatisfaction !== null ? userSatisfaction : null,
      dailyQuestions
    };

    console.log('📊 챗봇 통계 계산 완료:', {
      totalQuestions,
      averageResponseTime: chatStats.averageResponseTime,
      accuracy: chatStats.accuracy,
      userSatisfaction: chatStats.userSatisfaction,
      dailyQuestions,
      totalFeedback,
      helpfulFeedback,
      notHelpfulFeedback
    });

    return NextResponse.json({
      success: true,
      stats: chatStats
    });

  } catch (error) {
    console.error('❌ 챗봇 통계 API 오류:', error);
    
    return NextResponse.json({
      success: false,
      stats: {
        totalQuestions: 0,
        averageResponseTime: null,
        accuracy: null,
        userSatisfaction: null,
        dailyQuestions: 0
      }
    });
  }
}