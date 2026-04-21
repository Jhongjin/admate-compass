import { NextRequest, NextResponse } from 'next/server';

/**
 * 최적화된 구조화된 이메일 내용 생성 (브라우저 호환성 고려)
 */
function generateOptimizedEmailContent(question: string, aiResponse?: string, userName?: string, userEmail?: string, teamName: string = '페이스북 담당팀', recipientEmail: string = 'fb@nasmedia.co.kr'): string {
  const now = new Date();
  const ticketId = `FAQ-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getTime().toString().slice(-6)}`;
  const timestamp = now.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // 질문 카테고리 분류
  const category = categorizeQuestion(question);
  const priority = determinePriority(question);

  return `Ad-Mate 챗봇 문의사항 접수

안녕하세요, 담당팀님

Ad-Mate 챗봇을 통해 문의사항이 접수되었습니다.

[접수정보]
티켓: ${ticketId}
시간: ${timestamp}
카테고리: ${category.name}
우선순위: ${priority.level}
${userName && userEmail ? `질문자: ${userName} (${userEmail})` : userEmail ? `질문자: ${userEmail}` : ''}

[문의내용]
${formatQuestionContent(question)}
${aiResponse ? `\n[AI 챗봇 답변]\n${formatQuestionContent(aiResponse)}\n` : ''}

[시스템정보]
검색결과: 관련 문서 없음
신뢰도: 정보 부족
조치: ${category.recommendedAction}

[요청사항]
- 정확한 답변 제공
- 관련 자료 첨부 가능시 제공
- FAQ 업데이트 검토

[참고]
- AI 챗봇에서 관련 정보를 찾지 못함
- 내부 문서 업데이트 필요할 수 있음
- 답변 후 FAQ DB 업데이트 권장

응답시간: ${priority.responseTime}

[연락처]
회신: ${recipientEmail}
관리: Ad-Mate 챗봇 관리팀

자동생성: ${ticketId}

감사합니다.
Ad-Mate 챗봇`;
}

/**
 * 간소화된 이메일 내용 생성 (브라우저 호환성을 위해)
 */
function generateSimplifiedEmailContent(question: string, aiResponse?: string, userName?: string, userEmail?: string, teamName: string = '페이스북 담당팀', recipientEmail: string = 'fb@nasmedia.co.kr'): string {
  const now = new Date();
  const timestamp = now.toLocaleString('ko-KR');

  return `안녕하세요,

Ad-Mate 챗봇을 통해 문의사항이 접수되었습니다.

문의 시간: ${timestamp}
${userName && userEmail ? `질문자: ${userName} (${userEmail})` : userEmail ? `질문자: ${userEmail}` : ''}
문의 내용: ${question}
${aiResponse ? `\nAI 챗봇 답변:\n${aiResponse}\n` : ''}

위 문의사항에 대해 답변을 제공해 주시기 바랍니다.

감사합니다.
Ad-Mate 챗봇 시스템`;
}

/**
 * 구조화된 이메일 내용 생성 (참고용)
 */
function generateStructuredEmailContent(question: string, teamName: string = '페이스북 담당팀', recipientEmail: string = 'fb@nasmedia.co.kr'): string {
  const now = new Date();
  const ticketId = `FAQ-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getTime().toString().slice(-6)}`;
  const timestamp = now.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // 질문 카테고리 분류
  const category = categorizeQuestion(question);
  const priority = determinePriority(question);

  return `
╔════════════════════════════════════════════════════════════════════════════════════╗
║                           Ad-Mate 챗봇 문의사항 접수                                ║
╚════════════════════════════════════════════════════════════════════════════════════╝

안녕하세요, 담당팀님

Ad-Mate 챗봇 시스템을 통해 새로운 문의사항이 접수되었습니다.

┌─────────────────────────────────────────────────────────────────────────────────┐
│                                📋 접수 정보                                       │
└─────────────────────────────────────────────────────────────────────────────────┘

🎫 티켓 번호      : ${ticketId}
📅 접수 시간      : ${timestamp}
📂 문의 카테고리   : ${category.name}
⚡ 우선순위       : ${priority.level} (${priority.description})
🤖 접수 경로      : Meta FAQ AI 챗봇

┌─────────────────────────────────────────────────────────────────────────────────┐
│                                💬 문의 내용                                       │
└─────────────────────────────────────────────────────────────────────────────────┘

${formatQuestionContent(question)}

┌─────────────────────────────────────────────────────────────────────────────────┐
│                                📊 시스템 정보                                     │
└─────────────────────────────────────────────────────────────────────────────────┘

🔍 검색 결과      : 관련 내부 문서를 찾을 수 없음
📈 챗봇 신뢰도     : 정보 부족으로 답변 불가
🎯 추천 조치      : ${category.recommendedAction}

┌─────────────────────────────────────────────────────────────────────────────────┐
│                                📝 처리 요청사항                                    │
└─────────────────────────────────────────────────────────────────────────────────┘

✅ 요청사항:
   • 위 문의사항에 대한 정확한 답변 제공
   • 가능한 경우 관련 자료나 가이드라인 첨부
   • 향후 유사 질문 대응을 위한 FAQ 업데이트 검토

📋 참고사항:
   • 사용자는 AI 챗봇을 통해 답변을 찾으려 했으나 관련 정보를 찾지 못했습니다
   • 이 문의는 내부 문서 업데이트가 필요할 수 있음을 시사합니다
   • 답변 후 FAQ 데이터베이스 업데이트를 권장합니다

⏰ 예상 응답 시간: ${priority.responseTime}

┌─────────────────────────────────────────────────────────────────────────────────┐
│                                📞 연락처 정보                                     │
└─────────────────────────────────────────────────────────────────────────────────┘

📧 회신 주소      : ${recipientEmail}
🤖 시스템 관리     : Ad-Mate 챗봇 관리팀
📱 긴급 연락      : 시스템 장애 시 관리팀 연락 바랍니다

═══════════════════════════════════════════════════════════════════════════════════

이 메일은 Ad-Mate 챗봇 시스템에서 자동으로 생성되었습니다.
티켓 번호: ${ticketId}
생성 시간: ${new Date().toISOString()}

감사합니다.
Ad-Mate 챗봇 시스템 🤖
  `.trim();
}

/**
 * 질문 카테고리 분류
 */
function categorizeQuestion(question: string): { name: string; recommendedAction: string } {
  const lowerQuestion = question.toLowerCase();

  if (lowerQuestion.includes('정책') || lowerQuestion.includes('규정') || lowerQuestion.includes('가이드라인')) {
    return {
      name: '📋 정책 및 가이드라인',
      recommendedAction: '최신 정책 문서 확인 후 상세 답변 제공'
    };
  }

  if (lowerQuestion.includes('광고') || lowerQuestion.includes('캠페인') || lowerQuestion.includes('마케팅')) {
    return {
      name: '📢 광고 및 마케팅',
      recommendedAction: '광고 운영팀과 협의하여 전문적인 답변 제공'
    };
  }

  if (lowerQuestion.includes('계정') || lowerQuestion.includes('로그인') || lowerQuestion.includes('권한')) {
    return {
      name: '👤 계정 및 권한',
      recommendedAction: '계정 관리팀 검토 후 보안 고려사항 포함하여 답변'
    };
  }

  if (lowerQuestion.includes('기술') || lowerQuestion.includes('오류') || lowerQuestion.includes('버그')) {
    return {
      name: '🔧 기술적 문제',
      recommendedAction: '기술팀 에스컬레이션 후 해결방안 제시'
    };
  }

  if (lowerQuestion.includes('회사') || lowerQuestion.includes('조직') || lowerQuestion.includes('업무')) {
    return {
      name: '🏢 회사 및 조직',
      recommendedAction: '인사팀 또는 관련 부서 확인 후 공식 답변 제공'
    };
  }

  return {
    name: '❓ 일반 문의',
    recommendedAction: '관련 부서 확인 후 적절한 답변 제공'
  };
}

/**
 * 우선순위 결정
 */
function determinePriority(question: string): { level: string; description: string; responseTime: string } {
  const lowerQuestion = question.toLowerCase();

  if (lowerQuestion.includes('긴급') || lowerQuestion.includes('오류') || lowerQuestion.includes('문제')) {
    return {
      level: '🔴 높음',
      description: '긴급 처리 필요',
      responseTime: '4시간 이내'
    };
  }

  if (lowerQuestion.includes('정책') || lowerQuestion.includes('가이드라인')) {
    return {
      level: '🟡 보통',
      description: '정책 관련 중요 문의',
      responseTime: '1영업일 이내'
    };
  }

  return {
    level: '🟢 일반',
    description: '일반적인 문의사항',
    responseTime: '2-3영업일 이내'
  };
}

/**
 * 질문 내용 포맷팅
 */
function formatQuestionContent(question: string): string {
  // 질문이 너무 길면 줄바꿈 추가
  if (question.length > 100) {
    return question.match(/.{1,80}(\s|$)/g)?.join('\n   ') || question;
  }
  return `   ${question}`;
}


/**
 * 벤더별 설정 정보 조회
 */
function getVendorConfig(vendor?: string): { email: string; teamName: string } {
  const configs: Record<string, { email: string; teamName: string }> = {
    'GOOGLE': { email: 'google@nasmedia.co.kr', teamName: '구글애즈 담당팀' },
    'META': { email: 'fb@nasmedia.co.kr', teamName: '메타 담당팀' },
    'KAKAO': { email: 'mc1@nasmedia.co.kr', teamName: '카카오 담당팀' },
    'NAVER': { email: 'mc2@nasmedia.co.kr', teamName: '네이버 담당팀' },
    'X(TWITTER)': { email: 'tw@nasmedia.co.kr', teamName: 'X(트위터) 담당팀' },
    'ADSO': { email: 'adso@nasmedia.co.kr', teamName: '데이터분석팀(기본)' },
  };

  if (vendor) {
    const upperVendor = vendor.toUpperCase();
    if (configs[upperVendor]) {
      return configs[upperVendor];
    }
  }

  // 기본값 설정 (adso)
  return configs['ADSO'];
}

export async function POST(request: NextRequest) {
  try {
    const { question, aiResponse, userName, userEmail, vendor } = await request.json();

    // 입력 검증
    if (!question) {
      return NextResponse.json(
        { error: '질문이 필요합니다.' },
        { status: 400 }
      );
    }

    // 벤더 설정 조회
    const vendorConfig = getVendorConfig(vendor);

    // 이메일 내용 구성 (구조화된 버전 - 브라우저 호환성 고려)
    const emailSubject = `[Ad-Mate 챗봇] 문의사항: ${question.substring(0, 50)}...`;
    const emailBody = generateOptimizedEmailContent(question, aiResponse, userName, userEmail, vendorConfig.teamName, vendorConfig.email);

    // 이메일 링크 생성 (mailto:) - URL 길이 제한 고려
    const emailLink = `mailto:${vendorConfig.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

    console.log(`📧 이메일 연락처 요청: ${question.substring(0, 100)}... (Vendor: ${vendor || 'Default'})`);
    console.log(`📧 수신자: ${vendorConfig.email} (${vendorConfig.teamName})`);
    console.log(`📧 메일 링크 길이: ${emailLink.length}자`);

    // URL 길이가 너무 길면 간소화된 버전 사용 (매우 엄격한 제한)
    if (emailLink.length > 1200) {
      console.log('⚠️ URL이 너무 길어서 간소화된 버전 사용');
      const simplifiedBody = generateSimplifiedEmailContent(question, aiResponse, userName, userEmail, vendorConfig.teamName, vendorConfig.email);
      const simplifiedLink = `mailto:${vendorConfig.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(simplifiedBody)}`;
      console.log(`📧 간소화된 링크 길이: ${simplifiedLink.length}자`);

      return NextResponse.json({
        success: true,
        emailLink: simplifiedLink,
        recipientEmail: vendorConfig.email,
        teamName: vendorConfig.teamName,
        message: '메일이 성공적으로 발송되었습니다.',
        simplified: true
      });
    }

    return NextResponse.json({
      success: true,
      emailLink,
      recipientEmail: vendorConfig.email,
      teamName: vendorConfig.teamName,
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