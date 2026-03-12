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

    // 신뢰도 평가 및 요약 생성을 위한 강화된 프롬프트 (비판적 검증 및 보수적 평가 중심)
    const evaluationPrompt = `당신은 RAG(Retrieval-Augmented Generation) 시스템의 답변 신뢰성을 엄격하게 판별하는 '독립 검증 전문가'입니다.
제공된 "참고 문서"만을 법적 증거와 같이 엄중히 다루어 "답변"의 모든 실질적 주장을 검증하고 신뢰도를 산출하세요.

[검증 프로세스 (Thinking Process)]
1. **주장 추출**: 답변에서 날짜, 숫자, 정책, 절차, 고유 명사 등 검증 가능한 모든 개별 주장을 나열하세요.
2. **증거 대조**: 각 주장이 참고 문서의 어느 위치에 명시되어 있는지 확인하세요. 단순히 유사한 맥락이 있는 것이 아니라, 구체적인 텍스트로 존재해야 합니다.
3. **불일치 식별**: 문서에 없거나, 문서 내용에서 논리적으로 비약된 부분, AI가 임의로 추론하거나 일반 상식으로 채워넣은 부분을 '비검증 주장(Unverified Claims)'으로 분류하세요.

[평가 기준 (수치 산출)]
* **절대 금기**: 근거가 확실하지 않은 상태에서 0.9 이상의 고득점을 주는 '모델의 낙관적 편향'을 경계하세요.
- **0.9 ~ 1.0 (완벽)**: 답변의 모든 단어와 수치가 문서에 명시됨. 단 하나의 사소한 추론이나 부연 설명도 자의적이지 않음.
- **0.7 ~ 0.8 (양호)**: 핵심 주장은 명확한 근거가 있으나, 어문 연결을 위한 사소한 부연 설명에 문서에 없는 상식적 내용이 포함됨.
- **0.4 ~ 0.6 (주의)**: 핵심 주장의 일부가 문서에서 확인되지 않거나, 문서의 파편화된 정보를 AI가 무리하게 연결하여 해석함.
- **0.1 ~ 0.3 (위험)**: 핵심 주장 중 상당수가 문서에 없거나 문서 내용과 정면으로 대치됨 (할루시네이션 가능성 매우 높음).
- **0.0 (불능)**: 답변과 문서 사이에 어떠한 유의미한 상관관계를 찾을 수 없음.

질문: ${userQuestion}

답변: ${aiResponse}

참고 문서:
${sources?.map((source: any, index: number) =>
      `${index + 1}. ${source.title}
   내용: ${source.excerpt.substring(0, 10000)}...`
    ).join('\n') || '없음'}

응답 형식 (반드시 아래 JSON 형식만 반환):
{
  "unverifiedClaims": ["문서에서 근거를 찾을 수 없는 주장 1", "추론이 포함된 부분 2"],
  "keyPoints": ["핵심 요약 1", "핵심 요약 2"],
  "documentHighlights": ["근거가 된 실제 문구 1", "실제 문구 2"],
  "confidence": 0.0~1.0 사이의 실수 (보수적으로 산출)
}`;

    let summaryText = '';

    // 2. Claude를 사용하여 평가 및 요약 생성 시도
    if (anthropic) {
      try {
        console.log('🤖 Claude를 통한 신뢰도 평가 시작');
        const message = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20240620', // 모델명 최신화
          max_tokens: 1024,
          temperature: 0, // 일관된 평가를 위해 0으로 고정
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
          model: 'gpt-4o', // 안정적인 지능형 모델로 변경
          messages: [
            { role: 'system', content: '당신은 답변의 정확성과 할루시네이션을 판별하는 평가 전문가입니다. 반드시 JSON으로만 응답하세요.' },
            { role: 'user', content: evaluationPrompt }
          ],
          temperature: 0, // 일관된 평가를 위해 0으로 고정
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
