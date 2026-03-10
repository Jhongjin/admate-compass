import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// 동적 렌더링 강제 (SSE 방지)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Claude AI 초기화
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export async function POST(request: NextRequest) {
  try {
    const { userQuestion, aiResponse, sources } = await request.json();

    if (!userQuestion || !aiResponse) {
      return NextResponse.json(
        { error: '사용자 질문과 AI 응답이 필요합니다.' },
        { status: 400 }
      );
    }

    // Claude API가 설정되지 않은 경우 fallback 응답
    if (!anthropic) {
      console.log('⚠️ Claude API가 설정되지 않음. Fallback 요약 생성');
      const fallbackResponse = {
        keyPoints: [
          aiResponse.split('.')[0]?.trim() || '답변의 첫 번째 핵심 내용',
          aiResponse.split('.')[1]?.trim() || '답변의 두 번째 핵심 내용',
          aiResponse.split('.')[2]?.trim() || '답변의 세 번째 핵심 내용'
        ].filter(point => point.length > 10).slice(0, 5),
        documentHighlights: sources?.slice(0, 2).map((source: any) =>
          source.excerpt.substring(0, 80) + '...'
        ) || [],
        confidence: 0.7
      };
      return NextResponse.json(fallbackResponse, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
      });
    }

    // Claude를 사용한 답변 요약 생성
    const summaryPrompt = `다음 질문과 답변을 바탕으로 5줄 이하의 핵심 요약을 생성해주세요.

질문: ${userQuestion}

답변: ${aiResponse}

참고 문서:
${sources?.map((source: any, index: number) =>
      `${index + 1}. ${source.title} (${source.sourceType === 'file' ? '파일' : '웹페이지'})
   내용: ${source.excerpt.substring(0, 200)}...`
    ).join('\n') || '없음'}

요구사항:
1. 답변의 핵심 내용만 5줄 이하로 요약
2. 도입부 문구나 "Meta 광고 정책에 대해 궁금하신 점이 있으시군요" 같은 표현 사용 금지
3. 구체적이고 실용적인 정보 중심으로 작성
4. 각 줄은 간결하고 명확하게 작성
5. JSON 형식으로 응답

응답 형식 (JSON만 반환):
{
  "keyPoints": ["핵심 포인트 1", "핵심 포인트 2", "핵심 포인트 3"],
  "documentHighlights": ["문서 하이라이트 1", "문서 하이라이트 2"],
  "confidence": 0.85
}`;

    console.log('🤖 Claude 요약 생성 시작');
    let message;
    try {
      console.log('🔄 Claude 3.5 Sonnet 요약 시도...');
      message = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 1024,
        messages: [{ role: 'user', content: summaryPrompt }]
      });
    } catch (sonnetError: any) {
      if (sonnetError.status === 404) {
        console.warn('⚠️ Claude 3.5 Sonnet 을 찾을 수 없음. Haiku로 폴백합니다.');
        message = await anthropic.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1024,
          messages: [{ role: 'user', content: summaryPrompt }]
        });
      } else {
        throw sonnetError;
      }
    }

    const summaryText = message.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('');

    console.log('✅ Claude 요약 생성 완료');
    console.log('- 요약 길이:', summaryText.length);
    console.log('- 요약 미리보기:', summaryText.substring(0, 100) + '...');

    // JSON 파싱 시도
    try {
      // JSON 부분만 추출 (```json ... ``` 형태일 수 있음)
      const jsonMatch = summaryText.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? jsonMatch[0] : summaryText;

      const summaryData = JSON.parse(jsonText);

      // 데이터 검증 및 정리
      const validatedData = {
        keyPoints: Array.isArray(summaryData.keyPoints)
          ? summaryData.keyPoints.filter((point: string) => point && point.trim().length > 0).slice(0, 5)
          : [],
        documentHighlights: Array.isArray(summaryData.documentHighlights)
          ? summaryData.documentHighlights.filter((highlight: string) => highlight && highlight.trim().length > 0).slice(0, 3)
          : [],
        confidence: typeof summaryData.confidence === 'number'
          ? Math.min(Math.max(summaryData.confidence, 0), 1)
          : 0.8
      };

      // 응답 헤더 명시적으로 설정
      return NextResponse.json(validatedData, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
      });

    } catch (parseError) {
      console.error('❌ JSON 파싱 오류:', parseError);
      console.log('⚠️ Fallback 요약 생성');

      // JSON 파싱 실패 시 fallback 응답
      const fallbackResponse = {
        keyPoints: [
          aiResponse.split('.')[0]?.trim() || '답변의 첫 번째 핵심 내용',
          aiResponse.split('.')[1]?.trim() || '답변의 두 번째 핵심 내용',
          aiResponse.split('.')[2]?.trim() || '답변의 세 번째 핵심 내용'
        ].filter(point => point.length > 10).slice(0, 5),
        documentHighlights: sources?.slice(0, 2).map((source: any) =>
          source.excerpt.substring(0, 80) + '...'
        ) || [],
        confidence: 0.7
      };

      return NextResponse.json(fallbackResponse, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
      });
    }

  } catch (error) {
    console.error('❌ 요약 생성 오류:', error);

    // Claude API 오류 시 fallback 응답
    const fallbackResponse = {
      keyPoints: [
        '답변 요약을 생성할 수 없습니다.',
        '기본 정보를 확인해주세요.'
      ],
      documentHighlights: [],
      confidence: 0.3
    };

    return NextResponse.json(fallbackResponse, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  }
}
