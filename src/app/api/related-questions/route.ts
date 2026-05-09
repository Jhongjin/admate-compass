import { NextRequest, NextResponse } from 'next/server';
import { createCompassServiceClient } from '@/lib/supabase/compass';

const supabase = createCompassServiceClient();

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: '메시지가 필요합니다.' },
        { status: 400 }
      );
    }

    console.log(`🔍 관련 질문 추천 요청: "${message}"`);

    // 1. document_chunks에서 관련 내용 검색
    const { data: chunksData, error: chunksError } = await supabase
      .from('document_chunks')
      .select('content, metadata, document_id')
      .or(`content.ilike.%${message}%,content.ilike.%${message.split(' ')[0]}%,content.ilike.%${message.split(' ')[1] || ''}%`)
      .limit(10);

    if (chunksError || !chunksData || chunksData.length === 0) {
      console.log('⚠️ 관련 내용을 찾을 수 없음');
      return NextResponse.json({ relatedQuestions: [] });
    }

    // 2. 문서 내용에서 질문 패턴 추출
    const questionPatterns = [
      /(.*?)\?/g,
      /(.*?)에 대해/g,
      /(.*?)방법/g,
      /(.*?)기준/g,
      /(.*?)사양/g,
      /(.*?)정책/g,
      /(.*?)가이드/g,
      /(.*?)규정/g
    ];

    const extractedQuestions = new Set<string>();

    chunksData.forEach(chunk => {
      questionPatterns.forEach(pattern => {
        const matches = chunk.content.match(pattern);
        if (matches) {
          matches.forEach((match: any) => {
            const question = match.trim();
            if (question.length > 10 && question.length < 100) {
              extractedQuestions.add(question);
            }
          });
        }
      });
    });

    // 3. 질문을 유사도 순으로 정렬하고 상위 3개 선택
    const questions = Array.from(extractedQuestions)
      .map(q => ({
        question: q,
        similarity: calculateSimilarity(message, q)
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3)
      .map(item => item.question);

    console.log(`✅ 관련 질문 ${questions.length}개 추천`);

    return NextResponse.json({ relatedQuestions: questions });

  } catch (error) {
    console.error('❌ 관련 질문 추천 오류:', error);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

function calculateSimilarity(text1: string, text2: string): number {
  const words1 = text1.toLowerCase().split(/\s+/);
  const words2 = text2.toLowerCase().split(/\s+/);

  const intersection = words1.filter(word => words2.includes(word));
  const union = [...new Set([...words1, ...words2])];

  return intersection.length / union.length;
}

