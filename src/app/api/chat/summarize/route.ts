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

    // 신뢰도 평가 및 요약 생성을 위한 혁신 프롬프트 (v2.9 - 객관적 이진 검증)
    const evaluationPrompt = `당신은 RAG 시스템의 답변을 개별 주장 단위로 쪼개어 사실 관계를 이진 판단(Yes/No)하는 '데이터 검증 엔진'입니다.

[검증 프로토콜]
1. 답변을 5~10개의 독립적인 원자적 주장(Atomic Claims)으로 분해하세요.
2. 각 주장이 제공된 "참고 문서"에 명시되어 있는지 확인하세요.
3. 판단 기준:
   - **Supported: Yes** -> 문서에 명시적 근거가 있음.
   - **Supported: No** -> 문서에 없거나, AI의 추론/일반 지식이 포함됨.

[주의사항]
- AI 모델 특유의 '낙관적 편향'을 버리고, 증거가 없는 모든 사소한 추측은 "Supported: No"로 처리하세요.
- 당신은 직접적인 점수를 매기지 않습니다. 오직 각 주장의 참/거짓만 판별하세요.

질문: ${userQuestion}

답변: ${aiResponse}

참고 문서:
${sources?.map((source: any, index: number) =>
      `${index + 1}. ${source.title}
   내용: ${source.excerpt.substring(0, 10000)}...`
    ).join('\n') || '없음'}

응답 형식 (반드시 아래 JSON 형식만 반환):
{
  "claims": [
    { "claim": "주장 내용 1", "supported": "Yes" },
    { "claim": "주장 내용 2", "supported": "No" }
  ],
  "keyPoints": ["핵심 요약 1", "핵심 요약 2"],
  "documentHighlights": ["근거가 된 실제 문구 1", "실제 문구 2"]
}`;

    let summaryText = '';

    // 2. Claude를 사용하여 평가 및 요약 생성 시도
    if (anthropic) {
      try {
        console.log('🤖 Claude를 통한 신뢰도 평가 시작');
        const message = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022', // 표준 모델명으로 수정
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

        // --- 알고리즘 개편 (v2.9): 수학적 비율 기반 신뢰도 산출 ---

        // 1. Groundedness Ratio (주장 검증 성공률): 70% 비중
        const claims = Array.isArray(summaryData.claims) ? summaryData.claims : [];
        const supportedCount = claims.filter((c: any) => c.supported === 'Yes' || c.supported === true).length;
        const groundednessRatio = claims.length > 0 ? supportedCount / claims.length : 0.0;

        // 2. Retrieval Score (검색 유사도 평균): 30% 비중
        // sources 내의 score 값 활용 (0~1 사이로 가정, 보통 벡터 유사도는 0.7~0.9 사이임)
        const validSourceScores = sources
          ?.map((s: any) => s.score)
          .filter((s: any) => typeof s === 'number' && s > 0) || [];
        const avgRetrievalScore = validSourceScores.length > 0
          ? validSourceScores.reduce((a: number, b: number) => a + b, 0) / validSourceScores.length
          : 0.8; // 검색 점수 부재 시 기본값 0.8 (안정성)

        // 3. 최종 신뢰도 합산 공식
        let finalConfidence = (groundednessRatio * 0.7) + (avgRetrievalScore * 0.3);

        // 검색 점수가 너무 낮은 경우(관련 없는 문서)는 감점 페널티 적용
        if (avgRetrievalScore < 0.6) {
          finalConfidence *= 0.8;
        }

        // 범위 보정 (0.0 ~ 1.0)
        finalConfidence = Math.max(0.0, Math.min(1.0, finalConfidence));

        // 결과 반환 로직 동기화 (기존 필드 유지)
        const finalKeyPoints = (extractedKeyPoints && finalConfidence > 0.4)
          ? extractedKeyPoints
          : (summaryData.keyPoints || []);

        return NextResponse.json({
          keyPoints: finalKeyPoints.slice(0, 5),
          documentHighlights: Array.isArray(summaryData.documentHighlights) ? summaryData.documentHighlights.slice(0, 3) : [],
          confidence: parseFloat(finalConfidence.toFixed(2)),
          _debug: { // 디버깅용 (필요 시 클라이언트에서 무시 가능)
            groundednessRatio,
            avgRetrievalScore,
            totalClaims: claims.length,
            supportedCount
          }
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
