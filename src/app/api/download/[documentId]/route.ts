import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 유사도 계산 함수
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

// 레벤슈타인 거리 계산
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    
    console.log(`📥 파일 다운로드 요청: ${documentId}`);
    
    // 1. documents 테이블에서 문서 메타데이터 조회
    const { data: documentData, error: docError } = await supabase
      .from('documents')
      .select('id, title, type, created_at, updated_at, content')
      .eq('id', documentId)
      .single();
    
    if (docError || !documentData) {
      console.error('❌ 문서 데이터 조회 오류:', docError);
      return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
    }
    
    // 2. document_chunks에서 모든 청크 내용 조회
    const { data: chunksData, error: chunksError } = await supabase
      .from('document_chunks')
      .select('content, metadata')
      .eq('document_id', documentId)
      .order('metadata->chunk_index', { ascending: true });
    
    if (chunksError) {
      console.error('❌ 청크 데이터 조회 오류:', chunksError);
      return NextResponse.json({ error: '문서 내용을 찾을 수 없습니다.' }, { status: 404 });
    }
    
    // 3. 모든 청크 내용을 하나로 합치기 (중복 제거)
    let fullContent = '';
    if (chunksData && chunksData.length > 0) {
      // 청크를 chunk_index 순서로 정렬
      const sortedChunks = chunksData.sort((a, b) => {
        const aIndex = a.metadata?.chunk_index || 0;
        const bIndex = b.metadata?.chunk_index || 0;
        return aIndex - bIndex;
      });
      
      // 청크 내용을 합치되, 중복된 문장 제거
      const contentParts = sortedChunks.map(chunk => chunk.content.trim()).filter(content => content.length > 0);
      const uniqueParts: string[] = [];
      
      for (const part of contentParts) {
        // 이미 추가된 부분과 중복되는지 확인 (더 정교한 중복 검사)
        const isDuplicate = uniqueParts.some(existing => {
          // 완전히 동일한 경우
          if (existing === part) return true;
          
          // 한쪽이 다른 쪽을 완전히 포함하는 경우 (긴 것이 우선)
          if (existing.length > part.length && existing.includes(part)) return true;
          if (part.length > existing.length && part.includes(existing)) {
            // 기존 것을 새로운 것으로 교체
            const index = uniqueParts.indexOf(existing);
            uniqueParts[index] = part;
            return true;
          }
          
          // 부분적으로 겹치는 경우 (80% 이상 겹치면 중복으로 간주)
          const similarity = calculateSimilarity(existing, part);
          if (similarity > 0.8) return true;
          
          return false;
        });
        
        if (!isDuplicate) {
          uniqueParts.push(part);
        }
      }
      
      fullContent = uniqueParts.join('\n\n');
    } else {
      fullContent = documentData.content || '';
    }
    
    // 4. 실제 문서 내용으로 파일 생성
    const fileName = `${documentData.title || documentId}.txt`;
    const fileContent = `문서 제목: ${documentData.title || documentId}
문서 타입: ${documentData.type || 'unknown'}
문서 ID: ${documentData.id}
생성일: ${documentData.created_at ? new Date(documentData.created_at).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR')}
수정일: ${documentData.updated_at ? new Date(documentData.updated_at).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR')}

========================================
문서 내용
========================================

${fullContent}

========================================
청크 정보
========================================

총 청크 수: ${chunksData?.length || 0}`;
    
    return new NextResponse(fileContent, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
    
  } catch (error) {
    console.error('❌ 다운로드 API 오류:', error);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
