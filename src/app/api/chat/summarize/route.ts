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

    // 1. [SUMMARY] 태그가 이미 답변에 포함되어 있는지 확인 (포인트 추출용)
    const summaryTag = '[SUMMARY]';
    let extractedKeyPoints: string[] | null = null;

    if (aiResponse.includes(summaryTag)) {
      const summaryPart = aiResponse.split(summaryTag)[1].trim();
      const lines = summaryPart.split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line.startsWith('-') || line.startsWith('*') || (line.length > 0 && !line.startsWith('추가로')));

      if (lines.length > 0) {
        extractedKeyPoints = lines.slice(0, 5).map((l: string) => l.replace(/^[-*]\s*/, ''));
        console.log('✅ 답변 내 [SUMMARY] 태그에서 포인트 추출 성공');
      }
    }

    // 신뢰도 평가 및 요약 생성을 위한 강화된 프롬프트 (Groundedness 중심)
    const evaluationPrompt = `당신은 RAG(Retrieval-Augmented Generation) 시스템의 답변 신뢰성을 평가하는 '근거 검증 전문가'입니다.
제공된 "참고 문서"만을 근거로 "답변"의 모든 주장이 사실인지 검증하고 신뢰도를 측정해주세요.

[평가 기준]
1. **Fact Checking (주장별 검증)**:
   - 답변에 포함된 개별 주장(숫자, 기간, 정책, 이름 등)이 참고 문서에 명시적으로 존재하는지 확인하세요.
   - 문서에 없는 내용을 AI가 스스로 추론하거나 외부 지식을 섞어 답변했다면 '근거 없음'으로 간주하여 감점하세요.
   - 특히 잘린 숫자(예: 3 | 500만)를 문맥 없이 잘못 해석한 경우 큰 폭으로 감점하세요.

2. **Groundedness Score (신뢰도 수치 산출 기준)**:
   * AI의 습관적인 중간 점수(0.5) 부여를 금지합니다. 아래 기준에 맞춰 과감하게 평가하세요.
   - **0.9 ~ 1.0 (최상)**: 답변의 모든 실질적 내용이 문서에 명시됨.
   - **0.7 ~ 0.8 (양호)**: 핵심 내용은 문서에 근거하나, 일부 배경 설명이 일반 상식이거나 문서에 생략됨.
   - **0.3 ~ 0.4 (주의)**: 핵심 주장 중 일부가 문서와 다르거나, 근거를 찾을 수 없는 내용이 섞임.
   - **0.0 ~ 0.2 (위험)**: 답변의 주된 내용이 문서에 없거나 문서 내용과 정면으로 모순됨(할루시네이션).

3. **요구사항**:
   - 답변의 핵심 포인트 3~5개를 불렛 포인트로 요약.
   - 신뢰도 점수를 0.0~1.0 사이의 실수로 산출.
   - 문서에서 답변의 근거가 된 핵심 문구를 추출하여 documentHighlights에 포함.

질문: ${userQuestion}

답변: ${aiResponse}

참고 문서:
${sources?.map((source: any, index: number) =>
      `${index + 1}. ${source.title}
   내용: ${source.excerpt.substring(0, 3000)}...` // 700 -> 3000자 확대
    ).join('\n') || '없음'}

응답 형식 (반드시 아래 JSON 형식만 반환):
{
  "keyPoints": ["요약 포인트 1", "요약 포인트 2", "요약 포인트 3"],
  "documentHighlights": ["근거 문구 1", "근거 문구 2"],
  "confidence": 0.0~1.0 사이의 실수
}`;

    let summaryText = '';

    // 2. Claude를 사용하여 평가 및 요약 생성 시도
    if (anthropic) {
      try {
        console.log('🤖 Claude를 통한 신뢰도 평가 시작');
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          messages: [{ role: 'user', content: evaluationPrompt }]
        });

        summaryText = message.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('');
      } catch (claudeError: any) {
        console.error('⚠️ Claude 평가 실패:', claudeError.message);
      }
    }

    // 3. Claude 실패 시 GPT로 폴백
    if (!summaryText && openai) {
      try {
        console.log('🤖 OpenAI GPT를 통한 신뢰도 평가 시작 (폴백)');
        const completion = await openai.chat.completions.create({
          model: 'gpt-5-mini-2025-08-07',
          messages: [
            { role: 'system', content: '당신은 답변의 정확성과 할루시네이션을 판별하는 평가 전문가입니다. 반드시 JSON으로만 응답하세요.' },
            { role: 'user', content: evaluationPrompt }
          ],
          response_format: { type: 'json_object' }
        });

        summaryText = completion.choices[0].message.content || '';
      } catch (gptError: any) {
        console.error('❌ GPT 평가 최종 실패:', gptError.message);
      }
    }

    // 결과 파싱 및 반환
    if (summaryText) {
      try {
        const jsonMatch = summaryText.match(/\{[\s\S]*\}/);
        const jsonText = jsonMatch ? jsonMatch[0] : summaryText;
        const summaryData = JSON.parse(jsonText);

        // 신뢰도 누락 시 기본값은 0.0으로 하여 사용자에게 잘못된 안심을 주지 않음
        const finalConfidence = typeof summaryData.confidence === 'number' ? summaryData.confidence : 0.0;

        // 이미 추출된 포인트가 있다면 가급적 이를 사용하되, 평가 결과가 아주 낮으면 AI 요약을 따름
        const finalKeyPoints = (extractedKeyPoints && finalConfidence > 0.4)
          ? extractedKeyPoints
          : (summaryData.keyPoints || []);

        return NextResponse.json({
          keyPoints: finalKeyPoints.slice(0, 5),
          documentHighlights: Array.isArray(summaryData.documentHighlights) ? summaryData.documentHighlights.slice(0, 3) : [],
          confidence: finalConfidence
        }, {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      } catch (e) {
        console.error('❌ 결과 파싱 실패');
      }
    }

    // 모든 시도 실패 시 최종 Fallback (신뢰도는 0.0으로 설정)
    const finalFallback = {
      keyPoints: extractedKeyPoints || ['답변의 신뢰도를 평가할 수 없습니다.'],
      documentHighlights: [],
      confidence: 0.0
    };

    return NextResponse.json(finalFallback, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  } catch (error) {
    console.error('❌ 요약 API 최종 에러:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
