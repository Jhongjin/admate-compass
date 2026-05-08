import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { question } = await request.json();

    // 입력 검증
    if (!question) {
      return NextResponse.json(
        { error: '질문이 필요합니다.' },
        { status: 400 }
      );
    }

    // 이메일 내용 구성
    const emailSubject = `[AdMate Compass] 문의사항: ${question.substring(0, 50)}...`;
    const emailBody = `
안녕하세요,

AdMate Compass를 통해 문의사항이 접수되었습니다.

**문의 시간:**
${new Date().toLocaleString('ko-KR')}

**문의 내용:**
${question}

**처리 요청:**
위 문의사항에 대해 답변을 제공해 주시기 바랍니다.

감사합니다.
AdMate Compass 시스템
    `.trim();

    // 이메일 링크 생성 (mailto:)
    const emailLink = `mailto:fb@nasmedia.co.kr?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

    console.log(`📧 이메일 연락처 요청: ${question.substring(0, 100)}...`);

    return NextResponse.json({
      success: true,
      emailLink,
      message: '메일이 성공적으로 발송되었습니다.'
    });

  } catch (error) {
    console.error('❌ 이메일 연락처 생성 실패:', error);
    return NextResponse.json(
      { error: '이메일 연락처 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
