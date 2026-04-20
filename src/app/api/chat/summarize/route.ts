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

    // 0. 검색 엔진 신뢰도 산출 (Retrieval Score)
    const validSourceScores = sources
      ?.map((s: any) => s.score || s.similarity)
      .filter((s: any) => typeof s === 'number' && s > 0) || [];
    const retrievalConf = validSourceScores.length > 0
      ? Math.min(1.0, validSourceScores.reduce((a: number, b: number) => a + b, 0) / validSourceScores.length)
      : 0.5;

    // 1단계: 요약 생성 (Summarizer) - gpt-4o-mini 사용
    let keyPoints: string[] = [];
    let documentHighlights: string[] = [];

    if (openai) {
      try {
        console.log('🤖 [Step 1] 요약 생성 시작 (Summarizer: gpt-4o-mini)');
        const summaryCompletion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `당신은 긴 답변을 핵심 포인트로 요약하는 전문가입니다. 
제공된 답변 내용에서 가장 중요한 3~5가지 포인트를 추출하고, 해당 포인트의 근거가 되는 답변 내 핵심 문구를 함께 제공하세요. 
반드시 JSON 형식으로만 응답하세요.`
            },
            {
              role: 'user',
              content: `질문: ${userQuestion}\n\n답변: ${aiResponse}\n\n반드시 다음 구조의 JSON으로 응답하세요: {"keyPoints": ["포인트1", "포인트2"], "documentHighlights": ["근거문구1", "근거문구2"]}`
            }
          ],
          temperature: 0,
          response_format: { type: 'json_object' }
        });

        const summaryData = JSON.parse(summaryCompletion.choices[0].message.content || '{}');
        keyPoints = summaryData.keyPoints || [];
        documentHighlights = summaryData.documentHighlights || [];
      } catch (err) {
        console.error('❌ Summarizer 에러:', err);
      }
    }

    // 2단계: 신뢰도 평가 (Judge) - gpt-4o-mini 사용
    let judgeResult = {
      confidence: 0.7,
      subscores: { grounding: 0.7, relevance: 0.7, completeness: 0.7, nonHallucination: 0.7, citationCoverage: 0.7 },
      unsupportedClaims: [] as string[],
      notes: ""
    };

    if (openai && keyPoints.length > 0) {
      try {
        console.log('🤖 [Step 2] 신뢰도 평가 시작 (Judge: gpt-4o-mini)');
        const judgePrompt = `
당신은 요약된 내용이 원본 출처(Sources)에 근거하는지 정밀하게 평가하는 신뢰도 평가관(Judge)입니다.

[평가 축]
1. grounding: 요약 포인트가 출처 문서로 뒷받침되는가?
2. relevance: 질문 의도에 직접적으로 부합하는가?
3. completeness: 핵심 조건이나 제약 사항이 누락되지 않았는가?
4. nonHallucination: 출처에 없는 내용을 임의로 추측하지 않았는가?
5. citationCoverage: 각 포인트별로 충분한 근거가 존재하는가?

[입력 데이터]
- 질문: ${userQuestion}
- 요약 포인트: ${JSON.stringify(keyPoints)}
- 출처 문서(Sources):
${sources?.map((s: any, i: number) => `[출처 ${i}] ${s.title}: ${s.excerpt.substring(0, 1000)}`).join('\n')}

반드시 아래 JSON 스키마로만 응답하세요:
{
  "confidence": float(0~1),
  "subscores": {
    "grounding": float(0~1),
    "relevance": float(0~1),
    "completeness": float(0~1),
    "nonHallucination": float(0~1),
    "citationCoverage": float(0~1)
  },
  "unsupportedClaims": ["근거 부족 주장 내용"],
  "notes": "평가 총평"
}`;
        const judgeCompletion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: '객관적이고 엄격한 데이터 검증 엔진입니다. 반드시 JSON으로만 응답하세요.' },
            { role: 'user', content: judgePrompt }
          ],
          temperature: 0,
          response_format: { type: 'json_object' }
        });

        judgeResult = JSON.parse(judgeCompletion.choices[0].message.content || '{}');
      } catch (err) {
        console.error('❌ Judge 에러:', err);
      }
    }

    // 3. 최종 신뢰도 계산 (A+B+D 혼합 방식)
    // 공식: final_conf = 0.6 * judge_conf + 0.4 * retrieval_conf
    const judgeConf = judgeResult.confidence || 0.7;
    let finalConfidence = (0.6 * judgeConf) + (0.4 * retrievalConf);

    // [개선안 E] 실패 폴백 개선: 출처가 1개 이상이면 최소 0.5 보장
    if (sources && sources.length > 0 && finalConfidence < 0.5) {
      finalConfidence = 0.5 + (finalConfidence * 0.1); // 0.5 ~ 0.6 사이로 보정
    }

    // [개선안 F] 결과 반환
    return NextResponse.json({
      keyPoints: keyPoints.slice(0, 5),
      documentHighlights: documentHighlights.slice(0, 3),
      confidence: parseFloat(finalConfidence.toFixed(2)),
      subscores: judgeResult.subscores,
      unsupportedClaims: judgeResult.unsupportedClaims,
      notes: judgeResult.notes,
      _debug: {
        judgeConf,
        retrievalConf,
        summarizerModel: 'gpt-4o-mini',
        judgeModel: 'gpt-4o-mini'
      }
    }, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  } catch (error) {
    console.error('❌ 요약 API 최종 에러:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
