import { NextRequest, NextResponse } from 'next/server';

type ContactSource = {
  title?: string;
  url?: string;
  excerpt?: string;
};

function truncate(value: unknown, maxLength: number) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function sanitizeSources(value: unknown): ContactSource[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((source) => source && typeof source === 'object')
    .slice(0, 5)
    .map((source) => {
      const item = source as Record<string, unknown>;
      return {
        title: truncate(item.title, 120),
        url: typeof item.url === 'string' ? item.url : undefined,
        excerpt: truncate(item.excerpt || item.content, 280),
      };
    })
    .filter((source) => source.title || source.excerpt || source.url);
}

function getContactRecipient() {
  return process.env.COMPASS_CONTACT_EMAIL?.trim() || 'fb@nasmedia.co.kr';
}

export async function POST(request: NextRequest) {
  try {
    const {
      question,
      answer,
      sources,
      model,
      confidence,
      userEmail,
      userName,
    } = await request.json();

    if (!question || typeof question !== 'string') {
      return NextResponse.json(
        { error: '질문이 필요합니다.' },
        { status: 400 }
      );
    }

    const recipient = getContactRecipient();
    const safeSources = sanitizeSources(sources);
    const emailSubject = `[AdMate Compass] 추가 확인 요청: ${truncate(question, 50)}`;
    const sourceSection = safeSources.length > 0
      ? safeSources.map((source, index) => [
          `${index + 1}. ${source.title || '출처 제목 없음'}`,
          source.url ? `   URL: ${source.url}` : undefined,
          source.excerpt ? `   발췌: ${source.excerpt}` : undefined,
        ].filter(Boolean).join('\n')).join('\n\n')
      : '확인된 출처 없음';

    const emailBody = `
안녕하세요.

AdMate Compass 답변에 대해 담당자 추가 확인을 요청드립니다.

[요청자]
${truncate(userName || userEmail || 'Compass 사용자', 120)}
${userEmail ? `(${userEmail})` : ''}

[문의 시간]
${new Date().toLocaleString('ko-KR')}

[사용자 질문]
${question.trim()}

[Compass AI 답변]
${truncate(answer, 1800) || '답변 내용 없음'}

[확인한 출처]
${sourceSection}

[검토 메타]
- 모델/경로: ${truncate(model || 'Compass answer runtime', 120)}
- 출처 일치도: ${typeof confidence === 'number' ? `${Math.round(confidence)}%` : '미표시'}

확인 후 보완 기준이나 추가 출처가 있으면 회신 부탁드립니다.

감사합니다.
AdMate Compass
    `.trim();

    const emailLink = `mailto:${recipient}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

    console.log('Compass contact draft created', {
      questionLength: question.length,
      sourceCount: safeSources.length,
    });

    return NextResponse.json({
      success: true,
      recipient,
      emailLink,
      message: '담당자 확인 메일 초안이 생성되었습니다.',
    });

  } catch (error) {
    console.error('Compass contact draft creation failed:', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: '이메일 초안 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
