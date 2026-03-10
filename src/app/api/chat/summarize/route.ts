import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// 동적 렌더링 강제 (SSE 방지)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Claude AI 초기화
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// OpenAI (GPT) 초기화 (폴백용)
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
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

    // 1. [SUMMARY] 태그가 이미 답변에 포함되어 있는지 확인 (가장 빠르고 비용 효율적)
    const summaryTag = '[SUMMARY]';
    if (aiResponse.includes(summaryTag)) {
      const summaryPart = aiResponse.split(summaryTag)[1].trim();
      const lines = summaryPart.split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line.startsWith('-') || line.startsWith('*') || (line.length > 0 && !line.startsWith('추가로')));

      if (lines.length > 0) {
        console.log('✅ 답변 내 [SUMMARY] 태그에서 직접 요약 추출 성공');
        return NextResponse.json({
          keyPoints: lines.slice(0, 5).map((l: string) => l.replace(/^[-*]\s*/, '')),
          documentHighlights: sources?.slice(0, 2).map((source: any) =>
            source.excerpt.substring(0, 80) + '...'
          ) || [],
          confidence: 0.95
        }, {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }

    // 요약 생성을 위한 프롬프트
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

    let summaryText = '';

    // 2. Claude를 사용하여 요약 생성 시도
    if (anthropic) {
      try {
        console.log('🤖 Claude 요약 생성 시도');
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          messages: [{ role: 'user', content: summaryPrompt }]
        });

        summaryText = message.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('');
        console.log('✅ Claude 요약 생성 완료');
      } catch (claudeError: any) {
        console.error('⚠️ Claude 요약 생성 실패:', claudeError.message);
        // 실패 시 다음 단계(GPT)로 넘어감
      }
    }

    // 3. Claude 실패 또는 미설정 시 GPT로 폴백
    if (!summaryText && openai) {
      try {
        console.log('🤖 OpenAI GPT 요약 생성 시도 (폴백)');
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-2024-08-06',
          messages: [
            { role: 'system', content: '당신은 광고 정책 요약 전문가입니다. 반드시 JSON 형식으로만 응답하세요.' },
            { role: 'user', content: summaryPrompt }
          ],
          response_format: { type: 'json_object' }
        });

        summaryText = completion.choices[0].message.content || '';
        console.log('✅ GPT 요약 생성 완료');
      } catch (gptError: any) {
        console.error('❌ GPT 요약 생성 최종 실패:', gptError.message);
      }
    }

    // 결과 파싱 및 반환
    if (summaryText) {
      try {
        const jsonMatch = summaryText.match(/\{[\s\S]*\}/);
        const jsonText = jsonMatch ? jsonMatch[0] : summaryText;
        const summaryData = JSON.parse(jsonText);

        return NextResponse.json({
          keyPoints: Array.isArray(summaryData.keyPoints) ? summaryData.keyPoints.slice(0, 5) : [],
          documentHighlights: Array.isArray(summaryData.documentHighlights) ? summaryData.documentHighlights.slice(0, 3) : [],
          confidence: summaryData.confidence || 0.8
        }, {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      } catch (e) {
        console.error('❌ 요약 JSON 파싱 실패');
      }
    }

    // 모든 시도 실패 시 최종 Fallback
    const finalFallback = {
      keyPoints: [
        aiResponse.split('.')[0]?.trim() || '답변의 핵심 내용을 확인해주세요.',
        '상세 내용은 좌측 답변 본문을 참고하시기 바랍니다.'
      ].filter(p => p.length > 5),
      documentHighlights: [],
      confidence: 0.5
    };

    return NextResponse.json(finalFallback, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  } catch (error) {
    console.error('❌ 요약 API 최종 에러:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
