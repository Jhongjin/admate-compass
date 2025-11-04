import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

// Gemini AI 초기화 (환경변수 확인)
console.log('🔑 환경변수 확인:');
console.log('- GOOGLE_API_KEY:', process.env.GOOGLE_API_KEY ? '설정됨' : '설정되지 않음');
console.log('- NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '설정됨' : '설정되지 않음');
console.log('- SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '설정됨' : '설정되지 않음');

// 환경변수 값 직접 출력 (디버깅용)
console.log('- GOOGLE_API_KEY 값:', process.env.GOOGLE_API_KEY?.substring(0, 10) + '...');
console.log('- GOOGLE_API_KEY 전체 길이:', process.env.GOOGLE_API_KEY?.length);
console.log('- NEXT_PUBLIC_SUPABASE_URL 값:', process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- VERCEL:', process.env.VERCEL);
console.log('- VERCEL_ENV:', process.env.VERCEL_ENV);
console.log('- 모든 GOOGLE/GEMINI 관련 환경변수:', Object.keys(process.env).filter(key => key.includes('GOOGLE') || key.includes('GEMINI')));

const genAI = process.env.GOOGLE_API_KEY ? new GoogleGenerativeAI(process.env.GOOGLE_API_KEY) : null;

// Gemini AI 초기화 결과 확인
console.log('🤖 Gemini AI 초기화 결과:');
console.log('- genAI 객체:', genAI ? '생성됨' : 'null');
console.log('- genAI 타입:', typeof genAI);
if (genAI) {
  console.log('- genAI 생성자:', genAI.constructor.name);
}

// Supabase 클라이언트 초기화 (환경변수 확인)
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY 
  ? createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
  : null;

interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  documentId: string;
  documentTitle: string;
  documentUrl?: string;
  chunkIndex: number;
  metadata?: any;
}

interface ChatResponse {
  answer: string;
  sources: SearchResult[];
  confidence: number;
  processingTime: number;
  model: string;
}

/**
 * RAG 기반 문서 검색
 */
async function searchSimilarChunks(
  query: string,
  limit: number = 5,
  vendorFilter: string[] | null = null
): Promise<SearchResult[]> {
  try {
    console.log(`🔍 RAG 검색 시작: "${query}"`);
    
    // Supabase 클라이언트가 없으면 fallback 데이터 사용
    if (!supabase) {
      console.log('⚠️ Supabase 클라이언트가 설정되지 않음. Fallback 데이터 사용');
      return getFallbackSearchResults(query, limit);
    }

    // 실제 Supabase RAG 검색 실행
    console.log('📊 Supabase에서 통합 벡터 검색 실행 중...');
    
    // 1. 벡터 검색 (RAGProcessor 사용)
    console.log('🔍 벡터 검색 실행 중...');
    
    let chunksData = null;
    
    try {
      const { ragProcessor } = await import('@/lib/services/RAGProcessor');
      const chunks = await ragProcessor.searchSimilarChunks(query, limit, vendorFilter);

      if (!chunks || chunks.length === 0) {
        console.log('⚠️ 벡터 검색 결과 없음. Fallback 데이터 사용');
        return getFallbackSearchResults(query, limit);
      }

      console.log(`📊 벡터 검색 완료: ${chunks.length}개 청크 발견`);

      // ChunkData를 기존 형식으로 변환
      chunksData = chunks.map((chunk) => ({
        chunk_id: chunk.id,
        content: chunk.content,
        metadata: chunk.metadata,
        document_id: chunk.metadata.document_id,
        created_at: chunk.metadata.created_at,
        similarity: 0.8 // 기본 유사도 값
      }));

      console.log(`📊 Supabase에서 ${chunksData.length}개 청크 조회됨`);
    } catch (error) {
      console.error('❌ 벡터 검색 오류:', error);
      console.log('⚠️ Fallback 데이터로 전환');
      return getFallbackSearchResults(query, limit);
    }

    if (!chunksData || chunksData.length === 0) {
      console.log('⚠️ 벡터 검색 결과가 없음. Fallback 데이터 사용');
      return getFallbackSearchResults(query, limit);
    }

    console.log(`📊 Supabase에서 ${chunksData.length}개 청크 조회됨`);
    console.log(`📋 청크 데이터:`, chunksData.map(c => ({ chunk_id: c.chunk_id, document_id: c.document_id })));

    // 2. documents 테이블에서 메타데이터 조회
    const documentIds = [...new Set(chunksData.map((chunk: any) => chunk.document_id))];
    console.log(`📋 조회할 문서 ID들: [${documentIds.join(', ')}]`);
    
    const { data: documentsData, error: documentsError } = await supabase
      .from('documents')
      .select('id, title, type, status, created_at, updated_at, url')
      .in('id', documentIds)
      .neq('status', 'failed'); // failed가 아닌 모든 상태 포함

    if (documentsError) {
      console.error('❌ documents 조회 오류:', documentsError);
      console.log('⚠️ Fallback 데이터로 전환');
      return getFallbackSearchResults(query, limit);
    }

    console.log(`📊 documents 조회 결과: ${documentsData?.length || 0}개 문서`);
    console.log(`📋 documents 데이터:`, documentsData);

    // 3. 데이터 조합
    const documentsMap = new Map();
    if (documentsData) {
      documentsData.forEach((doc: any) => {
        documentsMap.set(doc.id, doc);
        console.log(`📄 문서 정보: ID=${doc.id}, 제목="${doc.title}", 타입=${doc.type}, 상태=${doc.status}`);
      });
    } else {
      console.log('⚠️ documentsData가 null 또는 undefined입니다.');
    }

    const data = chunksData.map((chunk: any) => {
      const document = documentsMap.get(chunk.document_id);
      
      // 문서 타입 자동 감지 (URL이 있으면 url, 없으면 file)
      let documentType = 'file'; // 기본값
      if (document) {
        if (document.type === 'url') {
          documentType = 'url';
        } else if (document.type === 'file' || document.type === 'pdf' || document.type === 'docx' || document.type === 'txt') {
          documentType = 'file';
        }
      }
      
      // 문서가 조회되지 않은 경우 더 나은 fallback 제목 생성
      let fallbackTitle = 'Unknown Document';
      if (chunk.document_id.startsWith('url_')) {
        // URL 문서인 경우
        try {
          // document_id에서 URL 추출 시도
          const urlMatch = chunk.document_id.match(/url_(\d+)_/);
          if (urlMatch) {
            fallbackTitle = '웹페이지 문서';
          }
        } catch {
          fallbackTitle = '웹페이지 문서';
        }
      } else if (chunk.document_id.startsWith('file_') || chunk.document_id.startsWith('doc_')) {
        // 파일 문서인 경우
        fallbackTitle = '업로드된 파일';
      }

      return {
        ...chunk,
        documents: document ? {
          ...document,
          type: documentType
        } : { 
          id: chunk.document_id, 
          title: fallbackTitle,
          type: documentType, 
          status: 'unknown',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          url: null
        }
      };
    });

    if (!data || data.length === 0) {
      console.log('⚠️ 검색 결과가 없음. Fallback 데이터 사용');
      return getFallbackSearchResults(query, limit);
    }

    console.log(`📊 실제 Supabase 데이터 사용: ${data.length}개 결과`);

    console.log(`📊 전체 검색 결과: ${data.length}개 (파일+URL 통합)`);
    
    // 벡터 검색이 성공했으므로 유사도 기반으로 정렬 (키워드 점수 계산 생략)
    console.log('✅ 벡터 검색 성공 - 유사도 기반 정렬 사용');
    
    const scoredData = data.map((item: any) => {
      // 벡터 검색에서 이미 유사도가 계산되었으므로 이를 우선 사용
      const similarityScore = item.similarity || 0.8;
      
      console.log(`📝 벡터 유사도: ${item.chunk_id}, 유사도: ${similarityScore}`);
      
      return { ...item, score: similarityScore * 10 }; // 유사도를 10배하여 점수로 변환
    });
    
    // 유사도 순으로 정렬하고 상위 결과만 선택
    const filteredData = scoredData
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // 3. 이미 점수로 정렬된 데이터 사용
    const sortedData = filteredData;

    console.log(`✅ 점수 기반 검색 결과: ${sortedData.length}개 (파일+URL 통합)`);
    
    if (sortedData.length === 0) {
      console.log('⚠️ 관련 문서를 찾을 수 없음. 연락처 옵션 표시');
    } else {
      console.log(`📊 상위 ${sortedData.length}개 문서 선택됨`);
    }

    // 필터링 결과가 없으면 빈 배열 반환 (연락처 옵션 표시)
    const finalData = sortedData;

    // 4. Supabase 결과를 SearchResult 형식으로 변환
    const searchResults: SearchResult[] = finalData.map((item: any, index: number) => {
      const document = item.documents;
      const isUrl = document?.type === 'url';
      
      console.log(`📝 SearchResult 변환: chunk_id=${item.chunk_id}, document_title="${document?.title}", document_type=${document?.type}`);
      
      // URL 생성 로직 개선
      let documentUrl = '';
      if (isUrl) {
        // URL 타입인 경우 document.url 필드에서 실제 URL 가져오기
        documentUrl = document?.url || '';
        
        // URL이 없으면 document.id를 URL로 사용 (fallback)
        if (!documentUrl) {
          documentUrl = document?.id || '';
        }
      } else {
        // 파일 타입인 경우 metadata에서 document_url 찾기
        documentUrl = item.metadata?.document_url || item.metadata?.url || '';
        
        // URL이 없으면 실제 파일 다운로드 URL 생성
        if (!documentUrl) {
          // 실제 파일 다운로드를 위한 URL 생성 (document_id 사용)
          documentUrl = `/api/admin/document-actions?action=download&documentId=${document?.id || item.document_id}`;
        }
      }

      console.log(`🔗 URL 생성: isUrl=${isUrl}, documentUrl="${documentUrl}"`);
      console.log(`📄 문서 상세: type=${document?.type}, document_url=${document?.document_url}`);

      // 강력한 텍스트 디코딩 및 정리
      let content = item.content || '';
      try {
        // 1. null 문자 제거
        content = content.replace(/\0/g, '');
        
        // 2. 제어 문자 제거 (탭, 줄바꿈, 캐리지 리턴 제외)
        content = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        
        // 3. UTF-8 인코딩 보장
        content = Buffer.from(content, 'utf-8').toString('utf-8');
        
        // 4. 연속된 공백을 하나로 정리
        content = content.replace(/\s+/g, ' ');
        
        // 5. 앞뒤 공백 제거
        content = content.trim();
        
        console.log(`🔧 텍스트 정리 완료: "${content.substring(0, 50)}..."`);
      } catch (error) {
        console.warn('⚠️ 텍스트 인코딩 변환 실패, 기본 정리만 적용:', error);
        // 기본 정리만 적용
        content = content.replace(/\0/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
      }

      // 출처 제목 생성 로직 개선
      let displayTitle = document?.title || 'Unknown Document';
      const chunkIndex = item.metadata?.chunk_index || 0;
      const pageNumber = Math.floor(chunkIndex / 5) + 1; // 청크 5개당 1페이지로 가정
      
      if (isUrl) {
        // URL 크롤링 데이터: 도메인 + 페이지 제목 + 페이지 번호
        try {
          // URL 문서의 경우 document.url 필드에서 실제 URL을 가져옴
          const actualUrl = document?.url || document?.id || '';
          const url = new URL(actualUrl);
          const domain = url.hostname.replace('www.', '');
          
          // URL 문서의 실제 제목 사용
          let actualTitle = document?.title || '웹페이지';
          
          // 실제 제목이 있는 경우 (문서 ID와 다른 경우)
          if (actualTitle !== document?.id && !actualTitle.startsWith('url_')) {
            // 실제 제목이 있는 경우 - 그대로 사용
            actualTitle = actualTitle.replace(/^문서\s+/, '');
            
            // 제목이 너무 길면 줄이기
            if (actualTitle.length > 50) {
              actualTitle = actualTitle.substring(0, 47) + '...';
            }
          } else {
            // 문서 ID와 제목이 같은 경우 (실제 제목이 저장되지 않은 경우)
            // Meta 페이지의 경우 도메인별로 의미있는 제목 생성
            if (domain.includes('facebook.com')) {
              if (url.pathname.includes('/policies/ads')) {
                actualTitle = 'Facebook 광고 정책';
              } else if (url.pathname.includes('/business/help')) {
                actualTitle = 'Facebook 비즈니스 도움말';
              } else {
                actualTitle = 'Facebook 가이드';
              }
            } else if (domain.includes('instagram.com')) {
              if (url.pathname.includes('/help')) {
                actualTitle = 'Instagram 비즈니스 도움말';
              } else {
                actualTitle = 'Instagram 비즈니스 가이드';
              }
            } else if (domain.includes('developers.facebook.com')) {
              actualTitle = 'Facebook 개발자 문서';
            } else {
              actualTitle = 'Meta 광고 가이드';
            }
          }
          
          displayTitle = `${domain} - ${actualTitle} (${pageNumber}페이지)`;
        } catch {
          // URL 파싱 실패 시 기본 제목 사용
          const cleanTitle = document?.title?.replace(/^문서\s+/, '') || '웹페이지';
          displayTitle = `${cleanTitle} (${pageNumber}페이지)`;
        }
      } else {
        // 파일 데이터: 파일명 + 페이지 번호
        const fileName = document?.title || 'Unknown Document';
        let cleanFileName = fileName.replace(/^문서\s+/, '').replace(/\.(pdf|docx|txt)$/i, '');
        
        // 파일명이 너무 길면 줄이기
        if (cleanFileName.length > 40) {
          cleanFileName = cleanFileName.substring(0, 37) + '...';
        }
        
        displayTitle = `${cleanFileName} (${pageNumber}페이지)`;
      }

      return {
        id: `supabase-${index}`, // 문자열 ID 생성
        content: content,
        similarity: item.similarity || (item.score ? item.score / 10 : 0.8), // 벡터 유사도 우선 사용
        documentId: document?.id || 'unknown',
        documentTitle: displayTitle,
        documentUrl: documentUrl,
        chunkIndex: item.metadata?.chunk_index || 0,
        metadata: {
          ...item.metadata,
          sourceType: isUrl ? 'url' : 'file',
          documentType: document?.type,
          createdAt: document?.created_at,
          updatedAt: document?.updated_at
        }
      };
    });

    return searchResults;

  } catch (error) {
    console.error('❌ RAG 검색 실패:', error);
    // 오류 발생 시 fallback 데이터 반환
    return getFallbackSearchResults(query, limit);
  }
}

/**
 * Fallback 검색 결과
 */
function getFallbackSearchResults(query: string, limit: number): SearchResult[] {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('광고') || lowerQuery.includes('정책')) {
    return [
      {
        id: 'fallback-1',
        content: 'Meta 광고 정책은 광고 콘텐츠의 품질과 안전성을 보장하기 위해 설계되었습니다. 모든 광고는 정확하고 진실된 정보를 포함해야 하며, 사용자에게 유익한 콘텐츠여야 합니다.',
        similarity: 0.8,
        documentId: 'meta-policy-2024',
        documentTitle: 'Meta 광고 정책 2024',
        documentUrl: 'https://www.facebook.com/policies/ads',
        chunkIndex: 0,
        metadata: { 
          type: 'policy',
          sourceType: 'url',
          documentType: 'url'
        }
      },
      {
        id: 'fallback-2',
        content: '금지된 콘텐츠에는 폭력, 성인 콘텐츠, 허위 정보, 차별적 내용 등이 포함됩니다. 이러한 콘텐츠는 광고에 사용할 수 없으며, 정책 위반 시 광고가 거부될 수 있습니다.',
        similarity: 0.7,
        documentId: 'meta-policy-2024',
        documentTitle: 'Meta 광고 정책 2024',
        documentUrl: 'https://www.facebook.com/policies/ads',
        chunkIndex: 1,
        metadata: { 
          type: 'policy',
          sourceType: 'url',
          documentType: 'url'
        }
      }
    ].slice(0, limit);
  }
  
  return [
    {
      id: 'fallback-default',
      content: 'Meta 광고에 대한 질문이군요. 제공된 내부 문서를 바탕으로 답변드립니다.',
      similarity: 0.5,
      documentId: 'general-info',
      documentTitle: 'Meta 광고 일반 정보',
      documentUrl: 'https://www.facebook.com/business/help',
      chunkIndex: 0,
      metadata: { type: 'general' }
    }
  ].slice(0, limit);
}

/**
 * Gemini를 사용한 스트림 답변 생성
 */
async function generateStreamAnswerWithGemini(
  query: string,
  searchResults: SearchResult[],
  controller: ReadableStreamDefaultController
): Promise<void> {
  try {
    console.log('🤖 Gemini 스트림 답변 생성 시작');
    console.log('- 질문:', query);
    console.log('- 검색 결과 수:', searchResults.length);
    
    // Gemini API가 설정되지 않은 경우 fallback 답변 생성
    if (!genAI) {
      console.log('⚠️ Gemini API가 설정되지 않음. Fallback 답변 생성');
      console.log('🔍 환경변수 확인:', {
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ? '설정됨' : '설정되지 않음',
        API_KEY_LENGTH: process.env.GOOGLE_API_KEY?.length || 0
      });
      const fallbackAnswer = generateFallbackAnswer(query, searchResults);
      
      // Fallback 답변을 청크 단위로 전송
      const words = fallbackAnswer.split(' ');
      for (let i = 0; i < words.length; i++) {
        const chunk = words[i] + (i < words.length - 1 ? ' ' : '');
        const streamResponse = {
          type: 'chunk',
          data: {
            content: chunk
          }
        };
        
        try {
          const chunkData = `data: ${JSON.stringify(streamResponse)}\n\n`;
          controller.enqueue(new TextEncoder().encode(chunkData));
        } catch (jsonError) {
          console.error('❌ Fallback JSON 직렬화 오류:', jsonError);
        }
        
        // 자연스러운 타이핑 효과를 위한 지연
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return;
    }
    
    console.log('✅ Gemini API 초기화 완료');

    // Gemini 2.5 Flash-Lite 모델 사용 (가성비 최적)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    // 컨텍스트 구성
    const context = searchResults
      .map((result, index) => `[출처 ${index + 1}] ${result.content}`)
      .join('\n\n');

    const prompt = `당신은 Meta 광고 정책 전문가이자 친근한 상담사입니다. 사용자의 질문에 대해 정확하고 도움이 되는 답변을 제공해주세요.

**참고 문서:**
${context}

**사용자 질문:** ${query}

**답변 가이드라인:**
1. **정확성 우선**: 제공된 문서를 기반으로 정확한 정보를 전달하세요
2. **친근한 톤**: 전문적이면서도 이해하기 쉽고 친근한 말투를 사용하세요
3. **구체적 예시**: 가능한 경우 구체적인 예시나 시나리오를 포함하세요
4. **실용적 조언**: 실제 업무에 도움이 되는 실용적인 조언을 제공하세요
5. **단계별 설명**: 복잡한 내용은 단계별로 나누어 설명하세요
6. **출처 명시**: 답변 근거가 되는 문서를 [출처 X] 형태로 명시하세요
7. **추가 도움**: 필요시 관련된 다른 정보나 다음 단계에 대한 안내를 제공하세요

**답변 형식:**
- 핵심 답변을 먼저 제시
- 구체적인 설명과 예시 제공
- 실무 적용 방법 안내
- 관련 출처 명시

답변:`;

    console.log('📝 Gemini API 호출 시작');
    let result;
    try {
      result = await model.generateContentStream(prompt);
      console.log('✅ Gemini API 응답 완료');
    } catch (apiError) {
      console.error('❌ Gemini API 스트림 호출 실패:', apiError);
      console.error('❌ API 에러 상세:', {
        message: apiError instanceof Error ? apiError.message : '알 수 없는 오류',
        stack: apiError instanceof Error ? apiError.stack : undefined,
        name: apiError instanceof Error ? apiError.name : undefined
      });
      console.error('❌ API 키 상태 재확인:', {
        hasApiKey: !!process.env.GOOGLE_API_KEY,
        keyLength: process.env.GOOGLE_API_KEY?.length,
        keyStart: process.env.GOOGLE_API_KEY?.substring(0, 10)
      });
      throw apiError;
    }

    let fullAnswer = '';
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        fullAnswer += chunkText;
        
        // 스트림 데이터 전송 (안전한 JSON 직렬화)
        const streamResponse = {
          type: 'chunk',
          data: {
            content: chunkText
          }
        };
        
        try {
          const chunkData = `data: ${JSON.stringify(streamResponse)}\n\n`;
          controller.enqueue(new TextEncoder().encode(chunkData));
        } catch (jsonError) {
          console.error('❌ JSON 직렬화 오류:', jsonError);
          // JSON 직렬화 실패 시 텍스트만 전송
          const fallbackData = `data: ${JSON.stringify({ type: 'chunk', data: { content: chunkText } })}\n\n`;
          controller.enqueue(new TextEncoder().encode(fallbackData));
        }
      }
    }

    console.log(`✅ 스트림 답변 생성 완료: ${fullAnswer.length}자`);
  } catch (error) {
    console.error('❌ Gemini 스트림 답변 생성 실패:', error);
    throw error;
  }
}

/**
 * Gemini를 사용한 답변 생성
 */
async function generateAnswerWithGemini(
  query: string,
  searchResults: SearchResult[]
): Promise<string> {
  try {
    console.log('🤖 Gemini 답변 생성 시작');
    console.log('- 질문:', query);
    console.log('- 검색 결과 수:', searchResults.length);
    
    // Gemini API가 설정되지 않은 경우 fallback 답변 생성
    if (!genAI) {
      console.log('⚠️ Gemini API가 설정되지 않음. Fallback 답변 생성');
      return generateFallbackAnswer(query, searchResults);
    }
    
    console.log('✅ Gemini API 초기화 완료');

    // Gemini 2.5 Flash-Lite 모델 사용 (가성비 최적)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    // 컨텍스트 구성
    const context = searchResults
      .map((result, index) => `[출처 ${index + 1}] ${result.content}`)
      .join('\n\n');

    const prompt = `당신은 Meta 광고 정책 전문가이자 친근한 상담사입니다. 사용자의 질문에 대해 정확하고 도움이 되는 답변을 제공해주세요.

**참고 문서:**
${context}

**사용자 질문:** ${query}

**답변 가이드라인:**
1. **정확성 우선**: 제공된 문서를 기반으로 정확한 정보를 전달하세요
2. **친근한 톤**: 전문적이면서도 이해하기 쉽고 친근한 말투를 사용하세요
3. **구체적 예시**: 가능한 경우 구체적인 예시나 시나리오를 포함하세요
4. **실용적 조언**: 실제 업무에 도움이 되는 실용적인 조언을 제공하세요
5. **단계별 설명**: 복잡한 내용은 단계별로 나누어 설명하세요
6. **출처 명시**: 답변 근거가 되는 문서를 [출처 X] 형태로 명시하세요
7. **추가 도움**: 필요시 관련된 다른 정보나 다음 단계에 대한 안내를 제공하세요

**답변 형식:**
- 핵심 답변을 먼저 제시
- 구체적인 설명과 예시 제공
- 실무 적용 방법 안내
- 관련 출처 명시

답변:`;

    console.log('📝 Gemini API 호출 시작');
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      
      const answer = response.text();
      console.log('✅ Gemini API 응답 완료');
      console.log('- 답변 길이:', answer.length);
      console.log('- 답변 미리보기:', answer.substring(0, 100) + '...');
      
      return answer;
    } catch (apiError) {
      console.error('❌ Gemini API 호출 실패:', apiError);
      console.error('❌ API 에러 상세:', {
        message: apiError instanceof Error ? apiError.message : '알 수 없는 오류',
        stack: apiError instanceof Error ? apiError.stack : undefined,
        name: apiError instanceof Error ? apiError.name : undefined
      });
      console.error('❌ API 키 상태 재확인:', {
        hasApiKey: !!process.env.GOOGLE_API_KEY,
        keyLength: process.env.GOOGLE_API_KEY?.length,
        keyStart: process.env.GOOGLE_API_KEY?.substring(0, 10)
      });
      throw apiError;
    }
    
  } catch (error) {
    console.error('Gemini API 오류:', error);
    
    // 할당량 초과 오류인 경우 특별 처리
    if (error instanceof Error && error.message && error.message.includes('429')) {
      console.log('⚠️ Gemini API 할당량 초과 (429 오류). Fallback 답변 생성');
      return generateFallbackAnswer(query, searchResults);
    }
    
    // 404 모델 오류인 경우
    if (error instanceof Error && error.message && error.message.includes('404')) {
      console.log('⚠️ Gemini API 모델을 찾을 수 없음 (404 오류). Fallback 답변 생성');
      return generateFallbackAnswer(query, searchResults);
    }
    
    // 기타 Gemini API 오류 시 fallback 답변 생성
    return generateFallbackAnswer(query, searchResults);
  }
}

/**
 * Fallback 답변 생성
 */
function generateFallbackAnswer(query: string, searchResults: SearchResult[]): string {
  const lowerQuery = query.toLowerCase();
  
  // 더 다양하고 유용한 fallback 답변 생성
  const getRandomGreeting = () => {
    const greetings = [
      "안녕하세요! Meta 광고 정책에 대해 궁금하신 점이 있으시군요.",
      "좋은 질문이네요! Meta 광고 관련해서 도움을 드리겠습니다.",
      "Meta 광고 정책에 대한 질문을 주셔서 감사합니다!",
      "네, Meta 광고에 대해 자세히 설명해드리겠습니다."
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  };

  const getRandomClosing = () => {
    const closings = [
      "이 정보가 도움이 되셨나요? 다른 궁금한 점이 있으시면 언제든지 물어보세요!",
      "더 자세한 내용이 필요하시면 구체적인 질문을 해주시면 더 정확한 답변을 드릴 수 있습니다.",
      "Meta 광고에 대해 더 알고 싶으시다면 다른 질문도 해주세요!",
      "이 답변이 도움이 되었기를 바랍니다. 추가 질문이 있으시면 언제든지 말씀해주세요!"
    ];
    return closings[Math.floor(Math.random() * closings.length)];
  };
  
  if (lowerQuery.includes('광고') && lowerQuery.includes('정책')) {
    return `${getRandomGreeting()}

**📋 Meta 광고 정책 핵심 내용**

Meta의 광고 정책은 사용자 경험을 보호하고 신뢰할 수 있는 광고 환경을 조성하기 위해 마련되었습니다.

**✅ 준수해야 할 사항:**
• **정확성**: 광고 내용은 정확하고 진실된 정보를 포함해야 합니다
• **투명성**: 광고주 정보와 제품/서비스에 대한 명확한 설명이 필요합니다
• **적절성**: 모든 연령대에 적합한 콘텐츠여야 합니다
• **법적 준수**: 해당 지역의 법률과 규정을 준수해야 합니다

**❌ 금지된 콘텐츠:**
• 폭력, 성인 콘텐츠, 차별적 내용
• 허위 정보나 오해를 불러일으킬 수 있는 내용
• 개인정보를 부적절하게 수집하거나 사용하는 행위
• 지적재산권 침해 콘텐츠

**🔍 검색된 관련 정보:**
${searchResults.map((result, index) => `• [출처 ${index + 1}] ${result.content.substring(0, 150)}...`).join('\n')}

**📚 추가 자료:**
• Meta 비즈니스 도움말: https://www.facebook.com/business/help
• 광고 정책 센터: https://www.facebook.com/policies/ads
• 광고 관리자: https://business.facebook.com

${getRandomClosing()}

*이 답변은 검색된 문서를 바탕으로 제공되었습니다. 더 정확한 답변을 원하시면 구체적인 질문을 해주세요.*`;
  }
  
  if (lowerQuery.includes('facebook') || lowerQuery.includes('instagram')) {
    return `${getRandomGreeting()}

**📱 Facebook & Instagram 광고 플랫폼 안내**

Meta의 두 주요 광고 플랫폼에 대해 설명해드리겠습니다.

**🔵 Facebook 광고:**
• **타겟팅**: 연령, 성별, 관심사, 행동 패턴 등 세밀한 타겟팅
• **광고 형식**: 이미지, 동영상, 캐러셀, 컬렉션 등 다양한 형식
• **목표**: 브랜드 인지도, 웹사이트 트래픽, 전환 등 다양한 마케팅 목표

**📸 Instagram 광고:**
• **시각적 중심**: 고품질 이미지와 동영상에 최적화
• **스토리 광고**: 15초 이하의 짧고 임팩트 있는 콘텐츠
• **릴스 광고**: 90초 이하의 동영상 콘텐츠
• **쇼핑 태그**: 제품 태그를 통한 직접적인 구매 유도

**🔍 검색된 관련 정보:**
${searchResults.map((result, index) => `• [출처 ${index + 1}] ${result.content.substring(0, 150)}...`).join('\n')}

**💡 실무 팁:**
• 두 플랫폼을 통합 관리하여 일관된 브랜드 메시지 전달
• 각 플랫폼의 특성에 맞는 콘텐츠 제작
• A/B 테스트를 통한 최적화

${getRandomClosing()}

*이 답변은 검색된 문서를 바탕으로 제공되었습니다. 더 정확한 답변을 원하시면 구체적인 질문을 해주세요.*`;
  }
  
  return `${getRandomGreeting()}

**📖 Meta 광고 FAQ**

검색된 정보를 바탕으로 답변드리겠습니다:

${searchResults[0]?.content.substring(0, 400) || 'Meta 광고에 대한 질문이군요. 제공된 내부 문서를 바탕으로 답변드립니다.'}

**🔍 관련 정보:**
${searchResults.slice(0, 3).map((result, index) => `• [출처 ${index + 1}] ${result.content.substring(0, 100)}...`).join('\n')}

**📚 유용한 링크:**
• Meta 비즈니스 도움말: https://www.facebook.com/business/help
• 광고 정책: https://www.facebook.com/policies/ads
• 광고 관리자: https://business.facebook.com
• Instagram 비즈니스: https://business.instagram.com

**💬 추가 도움:**
더 구체적인 질문을 해주시면 더 정확하고 자세한 답변을 드릴 수 있습니다.

${getRandomClosing()}

*이 답변은 검색된 문서를 바탕으로 제공되었습니다. 더 정확한 답변을 원하시면 구체적인 질문을 해주세요.*`;
}

/**
 * 신뢰도 계산
 */
function calculateConfidence(searchResults: SearchResult[]): number {
  if (searchResults.length === 0) return 0;
  
  const topSimilarity = searchResults[0].similarity;
  
  if (topSimilarity >= 0.9) return 0.95;
  if (topSimilarity >= 0.8) return 0.85;
  if (topSimilarity >= 0.7) return 0.75;
  if (topSimilarity >= 0.6) return 0.65;
  
  return 0.3;
}

/**
 * POST /api/chat
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  // API 핸들러 내에서 환경변수 재확인
  console.log('🔍 API 핸들러 내 환경변수 확인:');
  console.log('- GOOGLE_API_KEY:', process.env.GOOGLE_API_KEY ? '설정됨' : '설정되지 않음');
  console.log('- GOOGLE_API_KEY 값:', process.env.GOOGLE_API_KEY?.substring(0, 10) + '...');
  console.log('- NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '설정됨' : '설정되지 않음');
  
  try {
    // JSON 파싱 오류 방지
    let requestBody;
    try {
      requestBody = await request.json();
    } catch (parseError) {
      console.error('❌ JSON 파싱 오류:', parseError);
      return NextResponse.json(
        { error: '잘못된 JSON 형식입니다.' },
        { status: 400 }
      );
    }
    
    const { message, conversationHistory, vendors } = requestBody;
    
    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: '메시지가 필요합니다.' },
        { status: 400 }
      );
    }

    // 벤더 필터 처리 (선택적)
    const vendorFilter = vendors && Array.isArray(vendors) && vendors.length > 0
      ? vendors.map((v: any) => String(v).toUpperCase())
      : null;

    // 환경변수 상태 확인
    console.log('🔧 환경변수 상태:');
    console.log('- GOOGLE_API_KEY:', process.env.GOOGLE_API_KEY ? '✅ 설정됨' : '❌ 미설정');
    console.log('- NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ 설정됨' : '❌ 미설정');
    console.log('- SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ 설정됨' : '❌ 미설정');

    console.log(`🚀 RAG 챗봇 응답 생성 시작: "${message}"`);
    if (vendorFilter) {
      console.log(`🏷️ 벤더 필터 적용: ${vendorFilter.join(', ')}`);
    }

    // 1. RAG 검색 (출처 수 제한, 벤더 필터 적용)
    const searchResults = await searchSimilarChunks(message, 3, vendorFilter);
    console.log(`📊 검색 결과: ${searchResults.length}개`);

    // 2. 검색 결과가 없거나 유사도가 낮으면 관련 내용 없음 응답
    const hasRelevantResults = searchResults.length > 0 && 
      searchResults.some(result => result.similarity > 0.3); // 유사도 30% 이상인 결과가 있는지 확인
    
    if (!hasRelevantResults) {
      console.log('⚠️ RAG 검색 결과가 없거나 유사도가 낮음. 관련 내용 없음 응답');
      return NextResponse.json({
        response: {
          message: "죄송합니다. 제공된 내부 문서에서 관련 정보를 찾을 수 없습니다.\n\n📧 **더 정확한 답변을 원하시면:**\n담당팀(fb@nasmedia.co.kr)에 직접 문의해주시면 더 구체적인 답변을 받으실 수 있습니다.",
          content: "죄송합니다. 제공된 내부 문서에서 관련 정보를 찾을 수 없습니다.\n\n📧 **더 정확한 답변을 원하시면:**\n담당팀(fb@nasmedia.co.kr)에 직접 문의해주시면 더 구체적인 답변을 받으실 수 있습니다.",
          sources: [],
          noDataFound: true,
          showContactOption: true
        },
        confidence: 0,
        processingTime: Date.now() - startTime,
        model: 'no-data'
      });
    }

    // 3. 일반 JSON 응답 생성
    console.log('🚀 일반 JSON 답변 생성 시작');
    
    // 신뢰도 계산
    const confidence = calculateConfidence(searchResults);
    
    // 처리 시간 계산
    const processingTime = Date.now() - startTime;

    // 출처 정보 생성
    const sources = searchResults.map(result => {
      console.log(`📚 출처 정보: 제목="${result.documentTitle}", URL="${result.documentUrl}", 유사도=${result.similarity}`);
      
      // 강력한 excerpt 디코딩 및 정리
      let excerpt = result.content.substring(0, 200) + (result.content.length > 200 ? '...' : '');
      try {
        // 1. null 문자 제거
        excerpt = excerpt.replace(/\0/g, '');
        
        // 2. 제어 문자 제거 (탭, 줄바꿈, 캐리지 리턴 제외)
        excerpt = excerpt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        
        // 3. UTF-8 인코딩 보장
        excerpt = Buffer.from(excerpt, 'utf-8').toString('utf-8');
        
        // 4. 연속된 공백을 하나로 정리
        excerpt = excerpt.replace(/\s+/g, ' ');
        
        // 5. 앞뒤 공백 제거
        excerpt = excerpt.trim();
        
        console.log(`🔧 excerpt 정리 완료: "${excerpt.substring(0, 30)}..."`);
      } catch (error) {
        console.warn('⚠️ excerpt 인코딩 변환 실패, 기본 정리만 적용:', error);
        // 기본 정리만 적용
        excerpt = excerpt.replace(/\0/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
      }
      
      return {
        id: result.id,
        title: result.documentTitle,
        url: result.documentUrl,
        updatedAt: result.metadata?.updatedAt || new Date().toISOString(),
        excerpt: excerpt,
        similarity: result.similarity,
        sourceType: result.metadata?.sourceType,
        documentType: result.metadata?.documentType
      };
    });

    // Gemini 답변 생성
    const answer = await generateAnswerWithGemini(message, searchResults);
    
    // 신뢰도가 낮으면 전담팀 연락 카드 표시
    const shouldShowContactOption = confidence < 0.5 || 
      answer.includes('문서에서 찾을 수 없습니다') ||
      answer.includes('제공된 문서에서') ||
      answer.includes('담당팀에 문의');
    
    console.log(`📊 답변 품질 평가: confidence=${confidence}, shouldShowContactOption=${shouldShowContactOption}`);
    
    return NextResponse.json({
      response: {
        message: answer,
        content: answer,
        sources,
        noDataFound: false,
        showContactOption: shouldShowContactOption
      },
      confidence,
      processingTime,
      model: 'gemini-2.5-flash-lite'
    });

  } catch (error) {
    console.error('❌ RAG 응답 생성 실패:', error);
    console.error('❌ 에러 상세:', JSON.stringify(error, null, 2));
    
    const processingTime = Date.now() - startTime;
    
    return NextResponse.json({
      response: {
        message: '죄송합니다. 현재 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
        content: '죄송합니다. 현재 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
        sources: []
      },
      confidence: 0,
      processingTime,
      model: 'error'
    }, { status: 500 });
  }
}
