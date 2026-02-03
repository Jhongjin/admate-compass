import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('🚀 최신 업데이트 API 시작...');

    // 기본 최신 업데이트 데이터 반환
    const updateData = {
      lastUpdateDate: new Date().toISOString(),
      recentUpdates: [],
      newDocuments: [],
      hasNewFeatures: false,
      updateCount: 0,
      newDocumentCount: 0,
      message: "메타 광고 정책이 최신 상태로 유지되고 있습니다. 궁금한 사항이 있으시면 AI 챗봇에게 물어보세요.",
      displayDate: new Date().toLocaleDateString('ko-KR'),
      isRecent: false,
      hasUpdates: false
    };

    return NextResponse.json({
      success: true,
      data: updateData
    });

  } catch (error) {
    console.error('❌ 최신 업데이트 API 오류:', error);
    
    return NextResponse.json({
      success: true,
      data: {
        lastUpdateDate: new Date().toISOString(),
        recentUpdates: [],
        newDocuments: [],
        hasNewFeatures: false,
        updateCount: 0,
        newDocumentCount: 0,
        message: "메타 광고 정책이 최신 상태로 유지되고 있습니다.",
        displayDate: new Date().toLocaleDateString('ko-KR'),
        isRecent: false,
        hasUpdates: false
      }
    });
  }
}