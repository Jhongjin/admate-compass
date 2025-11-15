import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// Claude AI 초기화 (환경변수 확인)
console.log('🔑 환경변수 확인:');
console.log('- ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '설정됨' : '설정되지 않음');
console.log('- NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '설정됨' : '설정되지 않음');
console.log('- SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '설정됨' : '설정되지 않음');

// 환경변수 값 직접 출력 (디버깅용)
console.log('- ANTHROPIC_API_KEY 값:', process.env.ANTHROPIC_API_KEY?.substring(0, 10) + '...');
console.log('- ANTHROPIC_API_KEY 전체 길이:', process.env.ANTHROPIC_API_KEY?.length);
console.log('- NEXT_PUBLIC_SUPABASE_URL 값:', process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- VERCEL:', process.env.VERCEL);
console.log('- VERCEL_ENV:', process.env.VERCEL_ENV);

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
}) : null;

// OpenAI (GPT) 초기화 (보조 LLM)
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

// Claude AI 초기화 결과 확인
console.log('🤖 Claude AI 초기화 결과:');
console.log('- anthropic 객체:', anthropic ? '생성됨' : 'null');
console.log('- anthropic 타입:', typeof anthropic);
if (anthropic) {
  console.log('- anthropic 생성자:', anthropic.constructor.name);
}

// OpenAI (GPT) 초기화 결과 확인
console.log('🤖 OpenAI (GPT) 초기화 결과:');
console.log('- openai 객체:', openai ? '생성됨' : 'null');
console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '설정됨' : '설정되지 않음');

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
  sourceVendor?: string;
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
 * API 토큰 사용량 로깅 함수
 */
async function logApiUsage(
  provider: 'claude' | 'gpt',
  model: string,
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  conversationId?: string,
  userId?: string
): Promise<void> {
  try {
    if (!supabase) {
      console.warn('⚠️ Supabase 클라이언트가 없어 API 사용량을 로깅할 수 없습니다.');
      return;
    }

    // 비용 계산 (2025년 1월 기준 가격)
    let costUsd = 0;
    if (provider === 'claude') {
      // Claude 3.5 Haiku: $0.25/$1.25 per 1M tokens (input/output)
      const inputCost = (inputTokens / 1_000_000) * 0.25;
      const outputCost = (outputTokens / 1_000_000) * 1.25;
      costUsd = inputCost + outputCost;
    } else if (provider === 'gpt') {
      // GPT-4o-mini: $0.15/$0.60 per 1M tokens (input/output)
      const inputCost = (inputTokens / 1_000_000) * 0.15;
      const outputCost = (outputTokens / 1_000_000) * 0.60;
      costUsd = inputCost + outputCost;
    }

    const { error } = await supabase
      .from('api_usage_logs')
      .insert({
        provider,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        cost_usd: costUsd,
        conversation_id: conversationId || null,
        user_id: userId || null,
        metadata: {}
      });

    if (error) {
      console.error('❌ API 사용량 로깅 실패:', error);
    } else {
      console.log(`✅ API 사용량 로깅 완료: ${provider} - ${totalTokens} 토큰 ($${costUsd.toFixed(6)})`);
    }
  } catch (error) {
    console.error('❌ API 사용량 로깅 중 오류:', error);
    // 로깅 실패는 API 호출을 중단하지 않음
  }
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
      return getFallbackSearchResults(query, limit, vendorFilter);
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
        return getFallbackSearchResults(query, limit, vendorFilter);
      }

      console.log(`📊 벡터 검색 완료: ${chunks.length}개 청크 발견`);

      // ChunkData를 기존 형식으로 변환 (벤더 정보 및 타입 정보 포함)
      chunksData = chunks.map((chunk) => {
        const metadata = chunk.metadata as any;
        const documentType = metadata.document_type || (metadata.sourceType === 'url' ? 'url' : 'file');
        
        return {
          chunk_id: chunk.id,
          content: chunk.content,
          metadata: {
            ...metadata,
            document_type: documentType,
          },
          document_id: metadata.document_id,
          created_at: metadata.created_at,
          similarity: (chunk as any).similarity || 0.8, // RAGProcessor에서 반환된 유사도 사용
          source_vendor: metadata.source_vendor || null,
          document_type: documentType
        };
      });
      
      console.log(`📊 벤더 정보 포함: ${chunksData.filter(c => c.source_vendor).length}개 청크에 벤더 정보 있음`);

      console.log(`📊 Supabase에서 ${chunksData.length}개 청크 조회됨`);
    } catch (error) {
      console.error('❌ 벡터 검색 오류:', error);
      console.log('⚠️ Fallback 데이터로 전환');
      return getFallbackSearchResults(query, limit, vendorFilter);
    }

    if (!chunksData || chunksData.length === 0) {
      console.log('⚠️ 벡터 검색 결과가 없음. Fallback 데이터 사용');
      return getFallbackSearchResults(query, limit, vendorFilter);
    }

    console.log(`📊 Supabase에서 ${chunksData.length}개 청크 조회됨`);
    console.log(`📋 청크 데이터:`, chunksData.map(c => ({ chunk_id: c.chunk_id, document_id: c.document_id })));

    // 2. documents 테이블에서 메타데이터 조회
    const documentIds = [...new Set(chunksData.map((chunk: any) => chunk.document_id))];
    console.log(`📋 조회할 문서 ID들: [${documentIds.join(', ')}]`);
    
    const { data: documentsData, error: documentsError } = await supabase
      .from('documents')
      .select('id, title, type, status, created_at, updated_at, url, source_vendor')
      .in('id', documentIds)
      .neq('status', 'failed'); // failed가 아닌 모든 상태 포함

    if (documentsError) {
      console.error('❌ documents 조회 오류:', documentsError);
      console.log('⚠️ Fallback 데이터로 전환');
      return getFallbackSearchResults(query, limit, vendorFilter);
    }

    console.log(`📊 documents 조회 결과: ${documentsData?.length || 0}개 문서`);
    console.log(`📋 documents 데이터:`, documentsData);

    // 3. 데이터 조합
    const documentsMap = new Map();
    if (documentsData) {
      // 타입별 통계 계산
      const urlDocs = documentsData.filter((d: any) => d.type === 'url');
      const fileDocs = documentsData.filter((d: any) => d.type !== 'url');
      console.log(`📊 조회된 문서 타입별 통계: URL ${urlDocs.length}개, 파일 ${fileDocs.length}개 (총 ${documentsData.length}개)`);
      
      documentsData.forEach((doc: any) => {
        documentsMap.set(doc.id, doc);
        const typeLabel = doc.type === 'url' ? '🌐 URL' : '📄 파일';
        console.log(`📄 ${typeLabel} 문서 정보: ID=${doc.id}, 제목="${doc.title}", 타입=${doc.type}, 상태=${doc.status}, 벤더=${doc.source_vendor || '없음'}`);
      });
    } else {
      console.log('⚠️ documentsData가 null 또는 undefined입니다.');
    }

    const data = chunksData.map((chunk: any) => {
      const document = documentsMap.get(chunk.document_id);
      
      // 벤더 정보 우선순위: 문서의 source_vendor > 청크의 source_vendor
      const sourceVendor = document?.source_vendor || chunk.source_vendor || null;
      
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
        source_vendor: sourceVendor, // 문서 또는 청크에서 가져온 벤더 정보
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
          url: null,
          source_vendor: sourceVendor
        }
      };
    });

    if (!data || data.length === 0) {
      console.log('⚠️ 검색 결과가 없음. Fallback 데이터 사용');
      return getFallbackSearchResults(query, limit, vendorFilter);
    }

    console.log(`📊 실제 Supabase 데이터 사용: ${data.length}개 결과`);

    console.log(`📊 전체 검색 결과: ${data.length}개 (파일+URL 통합)`);
    
    // 키워드 추출 (질문에서 핵심 키워드 추출)
    const queryLower = query.toLowerCase();
    
    // 불용어 목록
    const stopWords = ['에', '를', '을', '의', '와', '과', '에 대해', '에 대해 설명', '알려줘', '소개해줘', '설명해줘', '가이드', '가이드를', '알려', '소개', '설명'];
    
    // 복합 키워드 패턴 (예: "전환API", "DV360", "포토뷰어")
    const compoundPatterns = [
      /전환\s*api/gi,
      /dv\s*360/gi,
      /포토\s*뷰어/gi,
      /youtube\s*상품/gi,
      /google\s*ads/gi,
      /meta\s*ads/gi,
    ];
    
    const queryKeywords: string[] = [];
    
    // 복합 키워드 먼저 추출
    compoundPatterns.forEach(pattern => {
      const matches = queryLower.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const cleaned = match.replace(/\s+/g, ''); // 공백 제거
          if (cleaned.length > 1) {
            queryKeywords.push(cleaned);
          }
        });
      }
    });
    
    // 나머지 단어 추출 (복합 키워드에 포함되지 않은 경우만)
    const words = queryLower.split(/\s+/);
    words.forEach(word => {
      const cleaned = word.trim();
      // 불용어가 아니고, 길이가 1보다 크며, 복합 키워드에 포함되지 않은 경우
      if (cleaned.length > 1 && 
          !stopWords.includes(cleaned) && 
          !queryKeywords.some(kw => cleaned.includes(kw) || kw.includes(cleaned))) {
        queryKeywords.push(cleaned);
      }
    });
    
    // 중복 제거
    const uniqueKeywords = Array.from(new Set(queryKeywords));
    
    console.log(`🔑 추출된 키워드: ${uniqueKeywords.join(', ')}`);
    
    // 벡터 검색이 성공했으므로 유사도 + 키워드 매칭 점수로 정렬
    console.log('✅ 벡터 검색 성공 - 유사도 + 키워드 매칭 점수 기반 정렬 사용');
    
    const scoredData = data.map((item: any) => {
      // 벡터 검색에서 이미 유사도가 계산되었으므로 이를 우선 사용
      // 가중치가 적용된 유사도가 있으면 사용 (피드백 학습 반영)
      let similarityScore = item.similarity || 0.8;
      
      // 가중치 정보가 있으면 로그 출력
      if (item.metadata?.weight_score) {
        const originalSimilarity = item.similarity || 0.8;
        const weightedSimilarity = item.metadata?.weighted_similarity || originalSimilarity;
        console.log(`📝 벡터 유사도: ${item.chunk_id}, 원본 유사도: ${originalSimilarity.toFixed(4)}, 가중치: ${item.metadata.weight_score.toFixed(2)}, 최종 유사도: ${weightedSimilarity.toFixed(4)}`);
        similarityScore = weightedSimilarity;
      }
      
      // 키워드 매칭 점수 계산
      let keywordScore = 0;
      const contentLower = (item.content || '').toLowerCase();
      const titleLower = (item.documents?.title || '').toLowerCase();
      const combinedText = `${titleLower} ${contentLower}`;
      
      // 복합 키워드 우선 매칭 (더 높은 점수)
      const compoundKeywords = uniqueKeywords.filter(kw => kw.length > 3 || /[a-z]/.test(kw));
      compoundKeywords.forEach(keyword => {
        // 제목에 복합 키워드가 있으면 매우 높은 점수
        if (titleLower.includes(keyword)) {
          keywordScore += 0.5;
        }
        // 내용에 복합 키워드가 있으면 높은 점수
        else if (contentLower.includes(keyword)) {
          keywordScore += 0.3;
        }
      });
      
      // 특정 키워드 강화: "연동형", "비연동형", "집행금액" 등 중요한 키워드에 추가 점수
      const importantKeywords = ['연동형', '비연동형', '집행금액', '최소집행', '최소', '집행', '방법', '안내'];
      importantKeywords.forEach(keyword => {
        if (contentLower.includes(keyword) || titleLower.includes(keyword)) {
          keywordScore += 0.4; // 중요한 키워드에 추가 점수
        }
      });
      
      // 단일 키워드 매칭 (복합 키워드에 포함되지 않은 경우만)
      const singleKeywords = uniqueKeywords.filter(kw => !compoundKeywords.includes(kw));
      singleKeywords.forEach(keyword => {
        // 제목에 키워드가 있으면 높은 점수
        if (titleLower.includes(keyword)) {
          keywordScore += 0.3;
        }
        // 내용에 키워드가 있으면 중간 점수
        else if (contentLower.includes(keyword)) {
          keywordScore += 0.1;
        }
      });
      
      // 키워드 점수는 최대 1.0까지
      keywordScore = Math.min(keywordScore, 1.0);
      
      // 최종 점수 = 유사도 (70%) + 키워드 매칭 (30%)
      const finalScore = (similarityScore * 0.7) + (keywordScore * 0.3);
      
      if (keywordScore > 0) {
        console.log(`🔑 키워드 매칭: chunk_id=${item.chunk_id}, 키워드 점수=${keywordScore.toFixed(3)}, 최종 점수=${finalScore.toFixed(4)}`);
      }
      
      return { 
        ...item, 
        score: finalScore * 10, // 점수를 10배하여 정렬에 사용
        keywordScore: keywordScore // 디버깅용
      };
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
        sourceVendor: item.source_vendor || item.metadata?.source_vendor || null,
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
    return getFallbackSearchResults(query, limit, vendorFilter);
  }
}

/**
 * Fallback 검색 결과 (벤더별)
 */
function getFallbackSearchResults(query: string, limit: number, vendorFilter?: string[] | null): SearchResult[] {
  const lowerQuery = query.toLowerCase();
  
  // 벤더별 Fallback 데이터
  const vendorFallbacks: Record<string, SearchResult[]> = {
    'NAVER': [
      {
        id: 'fallback-naver-1',
        content: '네이버 검색광고는 키워드 기반 타겟팅을 통해 사용자에게 관련성 높은 광고를 제공합니다. 광고주는 검색 키워드, 지역, 시간대 등을 세밀하게 설정할 수 있습니다.',
        similarity: 0.8,
        documentId: 'naver-policy',
        documentTitle: '네이버 검색광고 정책',
        documentUrl: 'https://searchad.naver.com',
        chunkIndex: 0,
        sourceVendor: 'NAVER',
        metadata: { 
          type: 'policy',
          sourceType: 'url',
          documentType: 'url'
        }
      },
      {
        id: 'fallback-naver-2',
        content: '네이버 광고는 정확하고 진실된 정보를 포함해야 하며, 사용자에게 유익한 콘텐츠여야 합니다. 허위 정보, 과장된 표현, 차별적 내용은 금지됩니다.',
        similarity: 0.7,
        documentId: 'naver-policy',
        documentTitle: '네이버 검색광고 정책',
        documentUrl: 'https://searchad.naver.com',
        chunkIndex: 1,
        sourceVendor: 'NAVER',
        metadata: { 
          type: 'policy',
          sourceType: 'url',
          documentType: 'url'
        }
      }
    ],
    'KAKAO': [
      {
        id: 'fallback-kakao-1',
        content: '카카오 비즈보드는 카카오톡 채널과 연동된 마케팅 플랫폼입니다. 친구톡, 메시지, 배너 등 다양한 형식의 광고를 제공하며, 타겟팅 옵션이 풍부합니다.',
        similarity: 0.8,
        documentId: 'kakao-policy',
        documentTitle: '카카오 비즈보드 정책',
        documentUrl: 'https://bizboard.kakao.com',
        chunkIndex: 0,
        sourceVendor: 'KAKAO',
        metadata: { 
          type: 'policy',
          sourceType: 'url',
          documentType: 'url'
        }
      }
    ],
    'GOOGLE': [
      {
        id: 'fallback-google-1',
        content: 'Google Ads는 검색광고와 디스플레이 광고를 모두 지원합니다. 키워드 기반 타겟팅이 핵심이며, 광고 품질 점수에 따라 노출 순위가 결정됩니다.',
        similarity: 0.8,
        documentId: 'google-policy',
        documentTitle: 'Google Ads 정책',
        documentUrl: 'https://ads.google.com',
        chunkIndex: 0,
        sourceVendor: 'GOOGLE',
        metadata: { 
          type: 'policy',
          sourceType: 'url',
          documentType: 'url'
        }
      }
    ],
    'X(TWITTER)': [
      {
        id: 'fallback-x-1',
        content: 'X(Twitter) 광고는 실시간 소셜 미디어 환경에 최적화되어 있습니다. 트렌드 기반 타겟팅과 프로모션 트윗을 통해 브랜드 인지도를 높일 수 있습니다.',
        similarity: 0.8,
        documentId: 'x-policy',
        documentTitle: 'X(Twitter) 광고 정책',
        documentUrl: 'https://ads.twitter.com',
        chunkIndex: 0,
        sourceVendor: 'X(TWITTER)',
        metadata: { 
          type: 'policy',
          sourceType: 'url',
          documentType: 'url'
        }
      }
    ],
    'META': [
      {
        id: 'fallback-meta-1',
        content: 'Meta 광고 정책은 광고 콘텐츠의 품질과 안전성을 보장하기 위해 설계되었습니다. 모든 광고는 정확하고 진실된 정보를 포함해야 하며, 사용자에게 유익한 콘텐츠여야 합니다.',
        similarity: 0.8,
        documentId: 'meta-policy-2024',
        documentTitle: 'Meta 광고 정책 2024',
        documentUrl: 'https://www.facebook.com/policies/ads',
        chunkIndex: 0,
        sourceVendor: 'META',
        metadata: { 
          type: 'policy',
          sourceType: 'url',
          documentType: 'url'
        }
      },
      {
        id: 'fallback-meta-2',
        content: '금지된 콘텐츠에는 폭력, 성인 콘텐츠, 허위 정보, 차별적 내용 등이 포함됩니다. 이러한 콘텐츠는 광고에 사용할 수 없으며, 정책 위반 시 광고가 거부될 수 있습니다.',
        similarity: 0.7,
        documentId: 'meta-policy-2024',
        documentTitle: 'Meta 광고 정책 2024',
        documentUrl: 'https://www.facebook.com/policies/ads',
        chunkIndex: 1,
        sourceVendor: 'META',
        metadata: { 
          type: 'policy',
          sourceType: 'url',
          documentType: 'url'
        }
      }
    ]
  };
  
  // 벤더 필터가 있고 해당 벤더의 Fallback 데이터가 있으면 사용
  if (vendorFilter && vendorFilter.length > 0) {
    const vendor = vendorFilter[0].toUpperCase();
    if (vendorFallbacks[vendor]) {
      console.log(`📋 ${vendor} 벤더 Fallback 데이터 사용`);
      return vendorFallbacks[vendor].slice(0, limit);
    }
  }
  
  // 기본 Fallback (벤더 없음 또는 일반 질문)
  if (lowerQuery.includes('광고') || lowerQuery.includes('정책')) {
    return [
      {
        id: 'fallback-default-1',
        content: '광고 정책은 각 플랫폼마다 다르며, 사용자 경험을 보호하고 신뢰할 수 있는 광고 환경을 조성하기 위해 마련되었습니다.',
        similarity: 0.8,
        documentId: 'general-policy',
        documentTitle: '광고 정책 일반 정보',
        documentUrl: '',
        chunkIndex: 0,
        metadata: { type: 'general' }
      }
    ].slice(0, limit);
  }
  
  return [
    {
      id: 'fallback-default',
      content: '광고에 대한 질문이군요. 제공된 내부 문서를 바탕으로 답변드립니다.',
      similarity: 0.5,
      documentId: 'general-info',
      documentTitle: '광고 일반 정보',
      documentUrl: '',
      chunkIndex: 0,
      metadata: { type: 'general' }
    }
  ].slice(0, limit);
}

/**
 * 검색 결과에서 벤더 정보 추출
 */
function extractVendorsFromSearchResults(results: SearchResult[]): string[] {
  const vendors = new Set<string>();
  results.forEach(result => {
    if (result.sourceVendor) {
      vendors.add(result.sourceVendor.toUpperCase());
    }
  });
  return Array.from(vendors);
}

/**
 * 벤더별 이름 매핑
 */
function getVendorDisplayName(vendor: string): string {
  const vendorMap: Record<string, string> = {
    'META': 'Meta (Facebook, Instagram, Threads)',
    'NAVER': 'Naver',
    'KAKAO': 'Kakao',
    'GOOGLE': 'Google',
    'X(TWITTER)': 'X (Twitter)',
    'OTHER': '기타',
  };
  return vendorMap[vendor] || vendor;
}

/**
 * 멀티 플랫폼 프롬프트 생성
 */
function buildMultiVendorPrompt(
  query: string,
  searchResults: SearchResult[],
  vendors: string[]
): string {
  const vendorNames = vendors.map(v => getVendorDisplayName(v));
  
  let role = '멀티 플랫폼 광고 정책 전문가';
  if (vendors.length === 1) {
    role = `${vendorNames[0]} 광고 정책 전문가`;
  } else if (vendors.length > 1) {
    role = `${vendorNames.join(', ')} 등 멀티 플랫폼 광고 정책 전문가`;
  }

  // 벤더별 특성 가이드라인
  const vendorGuidelines: Record<string, string> = {
    'META': 'Meta 플랫폼은 Facebook, Instagram, Threads를 포함하며, 소셜 미디어 광고에 특화되어 있습니다.',
    'NAVER': 'Naver는 검색광고 중심이며, 키워드 기반 타겟팅과 검색 결과 노출이 핵심입니다.',
    'KAKAO': 'Kakao는 비즈보드 중심이며, 카카오톡 채널과 연동된 마케팅이 특징입니다.',
    'GOOGLE': 'Google은 검색광고와 디스플레이 광고를 모두 지원하며, 키워드 기반 타겟팅이 강점입니다.',
    'X(TWITTER)': 'X(Twitter)는 실시간 소셜 미디어 광고에 특화되어 있으며, 트렌드 기반 타겟팅이 가능합니다.',
  };

  const vendorSpecificGuidelines = vendors
    .map(v => vendorGuidelines[v])
    .filter(Boolean)
    .join('\n');

  // 질문에서 핵심 키워드 추출 (리워드, 광고, 최소집행금액 등)
  const questionKeywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 1)
    .filter(word => !['에', '를', '을', '의', '와', '과', '은', '는', '이', '가', '에 대해', '에 대해 설명해줘', '알려주세요', '알려줘', '설명해줘', '설명해', '알려', '줘', '주세요'].includes(word))
    .filter(word => !word.match(/^[^\w가-힣]+$/)); // 특수문자만 있는 단어 제외

  // 컨텍스트 구성 (전체 내용 로깅 및 잘린 숫자 패턴 필터링)
  const validResults: Array<{ result: SearchResult; index: number; hasTruncatedNumbers?: boolean }> = [];
  const invalidResults: Array<{ result: SearchResult; index: number; reason: string }> = [];
  
  // 질문에서 핵심 키워드 추출 (관련 질문에 대한 검색 시 사용)
  const questionKeyTerms = query
    .toLowerCase()
    .replace(/[?？]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 1)
    .filter(word => !['에', '를', '을', '의', '와', '과', '은', '는', '이', '가', '에 대해', '에 대해 설명해줘', '알려주세요', '알려줘', '설명해줘', '설명해', '알려', '줘', '주세요', '어떤', '있나요', '있나', '인가요', '인가', '얼마인가요', '얼마인가'].includes(word));
  
  searchResults.forEach((result, index) => {
    // 잘린 숫자 패턴 감지 (파이프로 구분된 숫자)
    const truncatedNumberPattern = /\d+\s*\|\s*\d+/g;
    const matches = result.content.match(truncatedNumberPattern);
    
    // 질문의 핵심 키워드가 포함되어 있는지 확인
    const contentLower = result.content.toLowerCase();
    const hasKeyTerms = questionKeyTerms.some(term => contentLower.includes(term));
    
    if (matches && matches.length > 0) {
      // 핵심 키워드가 포함되어 있으면 제외하지 않고 사용 (단, 숫자 정보는 신중하게 검증)
      if (hasKeyTerms) {
        console.warn(`⚠️ [출처 ${index + 1}] 잘린 숫자 패턴 감지: "${matches.join(', ')}" - 하지만 질문의 핵심 키워드가 포함되어 있어 사용합니다. (숫자 정보는 신중하게 검증 필요)`);
        validResults.push({ result, index: index + 1, hasTruncatedNumbers: true });
        return;
      } else {
        console.warn(`⚠️ [출처 ${index + 1}] 잘린 숫자 패턴 감지: "${matches.join(', ')}" - 질문과 관련성이 낮아 제외됩니다.`);
        invalidResults.push({ result, index: index + 1, reason: `잘린 숫자 패턴: ${matches.join(', ')}` });
        return; // 제외된 출처는 더 이상 검증하지 않음
      }
    }
    
    // 의심스러운 숫자 패턴 감지: 공백 없이 붙어있는 숫자 정보
    // 예: "최소집행금액500만원", "3,500만강력한" 등
    const suspiciousNumberPatterns = [
      /(?:금액|집행|최소|단가|적립금|광고비|정산금액|포인트|원|만|억|조|명|개|건|%|퍼센트)\d{1,3}(?:,\d{3})*(?:만|억|조|원|명|개|건|%|퍼센트)?[가-힣]/g, // 숫자 뒤에 한글이 바로 붙음
      /\d{1,3}(?:,\d{3})*(?:만|억|조|원|명|개|건|%|퍼센트)?[가-힣]{2,}/g, // 숫자 뒤에 한글이 바로 붙음 (2글자 이상)
      /[가-힣]\d{1,3}(?:,\d{3})*(?:만|억|조|원|명|개|건|%|퍼센트)?(?![\s.,])/g, // 한글 뒤에 숫자가 바로 붙고 공백/구두점이 없음
    ];
    
    let hasSuspiciousPattern = false;
    const suspiciousMatches: string[] = [];
    
    suspiciousNumberPatterns.forEach(pattern => {
      const found = result.content.match(pattern);
      if (found && found.length > 0) {
        found.forEach(match => {
          // "500만원"처럼 정상적인 패턴은 제외 (공백이나 구두점이 있거나, 문장 끝)
          if (!match.match(/^\d{1,3}(?:,\d{3})*(?:만|억|조|원|명|개|건|%|퍼센트)?$/)) {
            suspiciousMatches.push(match);
            hasSuspiciousPattern = true;
          }
        });
      }
    });
    
    if (hasSuspiciousPattern && suspiciousMatches.length > 0) {
      console.warn(`⚠️ [출처 ${index + 1}] 의심스러운 숫자 패턴 감지: "${suspiciousMatches.slice(0, 3).join(', ')}" - 이 출처의 숫자 정보는 신중하게 검증해야 합니다.`);
      // 의심스러운 패턴이 있어도 제외하지는 않지만, 프롬프트에 경고 추가
      validResults.push({ result, index: index + 1 });
    } else {
      validResults.push({ result, index: index + 1 });
    }
  });
  
  // 의심스러운 숫자 패턴이 있는 출처 추적
  const suspiciousResults: Array<{ result: SearchResult; index: number; patterns: string[] }> = [];
  
  // "3,500만" 같은 완전한 숫자 패턴이 있는 출처 우선 확인
  const completeNumberPattern = /3[,，]\s*500\s*만|3\s*[,，]\s*500\s*만|3,500만|3500만/gi;
  const hasCompleteNumber = validResults.some(({ result }) => completeNumberPattern.test(result.content));
  
  if (hasCompleteNumber) {
    console.log(`✅ 완전한 숫자 패턴 "3,500만" 발견 - 이 정보를 우선 사용하세요.`);
  }
  
  // 잘린 숫자 패턴이 있는 출처는 제외하고 컨텍스트 구성
  const context = validResults
    .map(({ result, index, hasTruncatedNumbers }) => {
      const vendorInfo = result.sourceVendor ? `[${getVendorDisplayName(result.sourceVendor)}] ` : '';
      // 디버깅을 위한 전체 내용 로깅
      console.log(`📄 [출처 ${index}] 전체 내용 (${result.content.length}자):`, result.content);
      
      // 잘린 숫자 패턴이 있지만 사용하는 경우 경고 추가
      if (hasTruncatedNumbers) {
        console.warn(`⚠️ [출처 ${index}] 잘린 숫자 패턴이 있지만 질문의 핵심 키워드가 포함되어 사용합니다.`);
      }
      
      // "3,500만" 패턴 확인 및 로깅
      const completeMatches = result.content.match(completeNumberPattern);
      if (completeMatches && completeMatches.length > 0) {
        console.log(`✅ [출처 ${index}] 완전한 숫자 패턴 발견: "${completeMatches.join(', ')}" - 이 정보를 우선 사용하세요.`);
      }
      
      // "500만"이 "3,500만"의 일부인지 확인
      const partial500Pattern = /(?:^|[^3,，\s])500\s*만/gi;
      const partialMatches = result.content.match(partial500Pattern);
      if (partialMatches && partialMatches.length > 0 && !completeMatches) {
        console.warn(`⚠️ [출처 ${index}] "500만" 패턴 발견: "${partialMatches.join(', ')}" - 이것은 "3,500만"의 일부일 수 있습니다. 확인 필요.`);
      }
      
      // 의심스러운 숫자 패턴 재검사 (로깅용)
      const suspiciousPatterns = [
        /(?:금액|집행|최소|단가|적립금|광고비|정산금액|포인트|원|만|억|조|명|개|건|%|퍼센트)\d{1,3}(?:,\d{3})*(?:만|억|조|원|명|개|건|%|퍼센트)?[가-힣]/g,
        /\d{1,3}(?:,\d{3})*(?:만|억|조|원|명|개|건|%|퍼센트)?[가-힣]{2,}/g,
      ];
      
      const foundPatterns: string[] = [];
      suspiciousPatterns.forEach(pattern => {
        const matches = result.content.match(pattern);
        if (matches) {
          matches.forEach(match => {
            if (!match.match(/^\d{1,3}(?:,\d{3})*(?:만|억|조|원|명|개|건|%|퍼센트)?$/)) {
              foundPatterns.push(match);
            }
          });
        }
      });
      
      if (foundPatterns.length > 0) {
        suspiciousResults.push({ result, index, patterns: foundPatterns });
      }
      
      return `[출처 ${index}] ${vendorInfo}${result.content}`;
    })
    .join('\n\n');
  
  // 제외된 출처 로깅
  if (invalidResults.length > 0) {
    console.warn(`⚠️ 잘린 숫자 패턴으로 인해 ${invalidResults.length}개 출처가 제외되었습니다:`, 
      invalidResults.map(({ index, reason }) => `[출처 ${index}]: ${reason}`).join(', '));
  }
  
  // 잘린 숫자 패턴이 있지만 사용하는 출처 추적
  const resultsWithTruncatedNumbers = validResults.filter(({ hasTruncatedNumbers }) => hasTruncatedNumbers);
  
  // 의심스러운 숫자 패턴이 있는 출처 로깅
  if (suspiciousResults.length > 0) {
    console.warn(`⚠️ 의심스러운 숫자 패턴이 감지된 ${suspiciousResults.length}개 출처:`, 
      suspiciousResults.map(({ index, patterns }) => `[출처 ${index}]: ${patterns.slice(0, 2).join(', ')}`).join('; '));
  }
  
  if (resultsWithTruncatedNumbers.length > 0) {
    console.warn(`⚠️ 잘린 숫자 패턴이 있지만 질문의 핵심 키워드가 포함되어 사용하는 ${resultsWithTruncatedNumbers.length}개 출처:`, 
      resultsWithTruncatedNumbers.map(({ index }) => `[출처 ${index}]`).join(', '));
  }

  return `당신은 ${role}이자 친근한 상담사입니다. 사용자의 질문에 대해 정확하고 구체적이며 실용적인 답변을 제공해주세요.

**참고 문서:**
${context || '제공된 문서가 없습니다.'}

${invalidResults.length > 0 ? `\n**⚠️ 제외된 출처 (잘린 숫자 패턴 포함):**\n${invalidResults.map(({ index, reason }) => `- [출처 ${index}]: ${reason}`).join('\n')}\n\n이 출처들은 잘린 숫자 정보를 포함하고 있어 답변에 사용하지 마세요.\n` : ''}${resultsWithTruncatedNumbers.length > 0 ? `\n**⚠️ 중요: 잘린 숫자 패턴이 있지만 사용하는 출처:**\n${resultsWithTruncatedNumbers.map(({ index }) => `- [출처 ${index}]: 이 출처는 질문의 핵심 키워드를 포함하고 있어 사용하지만, 잘린 숫자 패턴(예: "3 | 500만", "1 | 400만")이 포함되어 있습니다.\n  **중요**: 이 출처의 숫자 정보는 신중하게 검증하세요. 잘린 숫자 패턴이 있는 부분(예: "3 | 500만")은 사용하지 마세요.\n  **사용 가능한 정보**: 숫자 정보가 아닌 다른 유용한 정보(예: 단가, 정산 기준, 지급 방법, 노출 영역, 특징 등)만 사용하세요.\n  **사용 불가능한 정보**: 잘린 숫자 패턴이 있는 숫자 정보는 절대 사용하지 마세요.\n`).join('')}\n` : ''}${suspiciousResults.length > 0 ? `\n**⚠️ 의심스러운 숫자 패턴이 있는 출처:**\n${suspiciousResults.map(({ index, patterns }) => `- [출처 ${index}]: "${patterns.slice(0, 2).join('", "')}" - 이 출처의 숫자 정보는 공백 없이 붙어있어 잘린 텍스트일 수 있습니다. 신중하게 검증하세요.\n`).join('')}\n` : ''}${hasCompleteNumber ? `\n**✅ 중요: 완전한 숫자 정보 발견:**\n참고 문서에 "3,500만" 또는 "3,500만명"이라는 완전한 숫자 정보가 포함되어 있습니다. 이 정보를 우선 사용하세요.\n**절대 금지**: "500만" 또는 "500만명"이라고 답변하지 마세요. 이것은 "3,500만"의 일부입니다.\n**올바른 답변**: "3,500만명" 또는 "3,500만"이라고 정확히 답변하세요.\n\n` : ''}

**사용자 질문:** ${query}

**중요 안내:**
- 위의 "참고 문서"에 포함된 모든 정보를 충분히 검토하세요.
- 사용자 질문과 관련된 모든 내용을 찾아 답변에 포함하세요.
- 예를 들어, 질문이 "연동형/비연동형"에 대한 것이라면, 참고 문서에서 "연동형", "비연동형", "방식", "지급시점", "지급방법", "정산기준", "단가" 등의 키워드가 포함된 모든 내용을 찾아 답변에 포함하세요.
- 질문이 "집행금액"에 대한 것이라면, "최소집행", "집행금액", "500만원" 등의 키워드가 포함된 모든 내용을 찾아 답변에 포함하세요.
- 참고 문서에 관련 정보가 있으면 반드시 답변에 포함하고, "찾을 수 없습니다"라고 답변하지 마세요.

${questionKeywords.length > 0 ? `**질문 핵심 키워드:** ${questionKeywords.join(', ')}\n\n` : ''}${vendorSpecificGuidelines ? `**플랫폼별 특성:**\n${vendorSpecificGuidelines}\n\n` : ''}🚨 **할루시네이션 방지 - 엄격한 규칙:**

**절대 금지 사항:**
1. **문서 외 정보 사용 금지**: 위에 제공된 "참고 문서"에 없는 모든 정보는 절대 사용하지 마세요
2. **추측 금지**: 문서에 명시되지 않은 내용을 "아마도", "추정됩니다", "일반적으로" 등의 표현으로 추측하지 마세요
3. **웹 검색 금지**: 인터넷 검색이나 외부 지식을 사용하지 마세요. 오직 제공된 문서만 사용하세요
4. **추론 금지**: 문서에 없는 정보를 논리적으로 추론하여 생성하지 마세요
5. **일반 지식 사용 금지**: 일반적인 광고 지식이나 업계 상식을 사용하지 마세요
6. **숫자/금액 정보 추론 금지**: 
   - 문서에 명시된 정확한 숫자나 금액만 사용하세요
   - 잘린 텍스트(예: "500만...", "3 | 500만")나 불완전한 숫자 정보는 절대 추론하거나 완성하지 마세요
   - **특히 주의**: "3 | 500만"처럼 파이프(|) 문자나 공백으로 구분된 숫자는 잘린 텍스트입니다. 절대 사용하지 마세요.
   - **중요**: 위의 "제외된 출처" 섹션에 나열된 출처들은 잘린 숫자 정보를 포함하고 있으므로 절대 참조하지 마세요.
   - 문서에 "500만원"이라고 명시되지 않았다면, "500만"이라는 부분만 보고 "500만원"이라고 추론하지 마세요
   - 숫자나 금액이 불완전하거나 명확하지 않으면 "제공된 문서에서 해당 정보를 찾을 수 없습니다"라고 답변하세요
   - **숫자 패턴 검증**: "숫자 | 숫자" 또는 "숫자 | 문자" 형태는 잘린 텍스트로 간주하고 무시하세요
   - **예시**: "3 | 500만"이라는 텍스트가 있으면, 이것은 "3,500만"이 아니라 잘린 텍스트입니다. "500만"이라고 추론하지 마세요. 해당 정보는 사용할 수 없습니다.

**필수 준수 사항:**
1. **문서 기반 답변만**: 반드시 위의 "참고 문서" 섹션에 있는 내용만을 바탕으로 답변하세요
2. **모르면 솔직히 말하기**: 문서에 없는 정보는 "제공된 문서에서 해당 정보를 찾을 수 없습니다" 또는 "문서에 명시되지 않았습니다"라고 솔직히 말하세요
3. **출처 명시 필수**: 모든 답변에 "[출처 X]" 형태로 출처를 반드시 명시하세요
4. **불확실한 정보 거부**: 문서에 명확하지 않은 내용은 "문서에서 확인할 수 없습니다"라고 답변하세요
5. **숫자/금액 검증 필수**: 
   - 답변에 포함할 모든 숫자나 금액은 반드시 "참고 문서"에서 완전한 형태로 명시되어 있어야 합니다
   - "500만원", "최소 집행 금액 500만원"처럼 완전한 문장으로 명시된 경우에만 사용하세요
   - 잘린 텍스트나 불완전한 정보는 절대 사용하지 마세요
   - **잘린 숫자 패턴 감지**: 다음 패턴은 잘린 텍스트로 간주하고 절대 사용하지 마세요:
     * "숫자 | 숫자" (예: "3 | 500만")
     * "숫자 | 문자" (예: "3 | 500만강력한")
     * 숫자 뒤에 바로 다른 문자가 붙어있고 공백이나 구두점이 없는 경우 (예: "500만강력한", "최소집행금액500만원")
   - **의심스러운 숫자 패턴**: 위의 "의심스러운 숫자 패턴이 있는 출처" 섹션에 나열된 출처의 숫자 정보는 공백 없이 붙어있어 잘린 텍스트일 수 있습니다. 이런 패턴이 있으면 해당 숫자 정보를 사용하지 마세요.
   - **특히 주의**: "최소집행금액500만원"처럼 공백 없이 붙어있는 숫자 정보는 의심스럽습니다. 문서에 "최소 집행 금액은 500만원"처럼 공백이 있는 완전한 문장으로 명시되어 있지 않으면 사용하지 마세요.
   - 의심스러우면 "제공된 문서에서 해당 정보를 찾을 수 없습니다"라고 답변하세요

**답변 가이드라인:**
1. **질문 관련성 필수**: 
   - 반드시 사용자 질문("${query}")과 직접 관련된 내용만 답변하세요
   - 질문의 핵심 키워드(${questionKeywords.length > 0 ? questionKeywords.join(', ') : '질문 내용'})와 관련 없는 정보는 포함하지 마세요
   - 예: 질문이 "리워드 광고"에 대한 것이라면, 일반적인 결제 서비스나 보안 기능 등 리워드 광고와 무관한 내용은 절대 포함하지 마세요
   - 각 출처에서 질문과 직접 관련된 부분만 선택적으로 인용하세요
2. **정확성 우선**: 제공된 문서에 명시된 내용만을 정확하게 전달하세요. 문서에 없는 정보는 절대 생성하지 마세요.
3. **구체성 강화**: 
   - 문서에 명시된 구체적인 수치, 절차, 예시를 포함하세요
   - 문서에 없는 예시는 만들지 마세요
   - 단계별 절차가 문서에 있다면 1단계, 2단계 형태로 명확히 나열하세요
   - **숫자 정확성**: 
     * 문서에 "3,500만" 또는 "3,500만명"이라고 명시되어 있다면 **절대 "500만" 또는 "500만명"으로 잘못 전달하지 마세요**. 정확히 "3,500만" 또는 "3,500만명"이라고 답변하세요.
     * **중요**: "500만"이라는 숫자가 나오면, 이것이 "3,500만"의 일부인지 반드시 확인하세요. 참고 문서에 "3,500만"이 있으면 "500만"은 사용하지 마세요.
     * "3 | 500만"처럼 파이프(|)로 구분된 숫자는 잘린 텍스트입니다. 절대 사용하지 마세요.
     * 숫자가 불완전하거나 잘린 것 같으면 해당 정보를 답변에 포함하지 마세요.
     * **특히 주의**: 네이버페이 리워드 광고 관련 질문에서 "500만"이라는 숫자가 나오면, 반드시 "3,500만"이 맞는지 확인하세요. 문서에 "3,500만"이 있으면 "500만"은 잘못된 정보입니다.
4. **플랫폼 구분**: 여러 플랫폼이 포함된 경우 각 플랫폼별로 명확히 구분하여 설명하세요. 문서에 명시된 플랫폼 간 차이점만 언급하세요.
5. **실무 중심**: 
   - 문서에 명시된 실제 업무 적용 방법만 제공하세요
   - 문서에 있는 주의사항, 제한사항, 예외 케이스만 안내하세요
6. **친근한 톤**: 전문적이면서도 이해하기 쉽고 친근한 말투를 사용하세요.
7. **구체적 예시**: 
   - 문서에 명시된 실제 시나리오나 케이스만 포함하세요
   - 문서에 없는 예시는 만들지 마세요
8. **단계별 설명**: 문서에 명시된 복잡한 내용은 단계별로 나누어 설명하세요.
9. **출처 명시 필수**: 답변의 모든 정보에 대해 [출처 X] 형태로 출처를 반드시 명시하세요.
10. **정보 부족 시 안내**: 문서에 없는 정보에 대해서는 담당팀 문의를 안내하세요.
11. **섹션 구분 엄수**: 
    - 질문이 특정 상품(예: "리워드 광고")에 대한 것이라면, 해당 상품 섹션의 내용만 사용하세요
    - 다른 상품(예: 일반 결제 서비스, 포인트 구매 등)의 내용은 질문과 관련이 없으면 포함하지 마세요

**답변 형식:**
- **핵심 답변 먼저**: 질문("${query}")과 직접 관련된 문서 내용을 바탕으로 핵심 답변을 1-2문장으로 먼저 제시
- **상세 설명**: 질문과 직접 관련된 문서의 구체적인 설명과 근거를 [출처 X]와 함께 제시
  - **중요**: 질문과 무관한 내용(예: 질문이 "리워드 광고"인데 일반 결제 서비스 설명)은 포함하지 마세요
- **플랫폼별 구분**: 문서에 명시된 여러 플랫폼 정보를 각각 명확히 구분하여 설명 (질문과 관련된 경우만)
- **구체적 예시**: 질문과 관련된 문서의 실제 예시나 시나리오만 포함
- **실무 적용 방법**: 질문과 관련된 문서의 단계별 절차나 주의사항을 구체적으로 안내
- **정보 부족 시**: 질문과 관련된 정보가 문서에 없으면 "제공된 문서에서 찾을 수 없습니다. 담당팀에 문의해주세요"라고 명확히 안내

**중요**: 
- 답변의 모든 정보는 반드시 위의 "참고 문서" 섹션에 있는 내용이어야 합니다
- 문서에 없는 정보는 절대 생성하거나 추측하지 마세요
- 모르는 것은 솔직히 "문서에서 찾을 수 없습니다"라고 말하세요
- 출처를 반드시 명시하세요
- **특히 숫자나 금액 정보**: 문서에 완전한 형태로 명시되지 않은 숫자/금액은 절대 사용하지 마세요. 잘린 텍스트나 불완전한 정보는 추론하지 마세요.

**답변 전 최종 확인 체크리스트:**
1. 답변에 포함된 모든 정보가 "참고 문서"에 명시되어 있는가?
2. 답변의 모든 내용이 사용자 질문("${query}")과 직접 관련이 있는가? (질문과 무관한 내용은 제외했는가?)
3. 숫자나 금액 정보가 완전한 형태로 문서에 명시되어 있는가? 
   - 잘린 텍스트 아님 (예: "3 | 500만" 같은 패턴 제외)
   - **중요**: "3,500만"을 "500만"으로 잘못 전달하지 않았는가? 참고 문서에 "3,500만"이 있으면 절대 "500만"이라고 답변하지 마세요.
   - "500만"이라는 숫자가 나오면, 이것이 "3,500만"의 일부인지 반드시 확인했는가?
   - 파이프(|) 문자나 공백으로 구분된 숫자는 사용하지 않았는가?
   - **특히**: "3 | 500만"이라는 텍스트가 있으면 이것은 "3,500만"이 아니라 잘린 텍스트입니다. "500만"이라고 추론하거나 사용하지 마세요.
   - **네이버페이 리워드 광고 관련**: "500만"이라는 숫자는 잘못된 정보입니다. 올바른 숫자는 "3,500만"입니다.
4. 모든 정보에 출처가 명시되어 있는가?
5. 문서에 없는 정보를 추론하거나 생성하지 않았는가?
6. 질문이 특정 상품/서비스에 대한 것인데, 다른 상품/서비스의 내용을 포함하지 않았는가?
7. 잘린 숫자 패턴("숫자 | 숫자", "숫자 | 문자")을 사용하지 않았는가?
8. **제외된 출처 목록에 있는 출처를 참조하지 않았는가?**

**⚠️ 절대 사용 금지 예시:**
- "3 | 500만" → 이것은 잘린 텍스트입니다. "500만"이라고 추론하지 마세요.
- "네이버페이의3 | 500만강력한" → 이것도 잘린 텍스트입니다. 사용하지 마세요.
- 위와 같은 패턴이 있으면 해당 숫자 정보는 완전히 무시하고, "제공된 문서에서 해당 정보를 찾을 수 없습니다"라고 답변하세요.

답변:`;
}

/**
 * 검색된 문서 기반 관련 질문 생성
 */
async function generateRelatedQuestions(
  query: string,
  searchResults: SearchResult[],
  vendorFilter?: string[] | null
): Promise<string[]> {
  try {
    if (!searchResults || searchResults.length === 0) {
      return [];
    }

    console.log(`💡 관련 질문 생성 시작: 검색 결과 ${searchResults.length}개 기반`);

    // 검색된 문서 내용 요약 (더 많은 컨텍스트 제공)
    const documentContents = searchResults
      .slice(0, 6) // 상위 6개 사용 (더 많은 문서 포함)
      .map((result, index) => {
        // 각 청크는 최대 800자로 증가 (더 많은 컨텍스트)
        const content = result.content.substring(0, 800);
        const title = result.documentTitle || '문서';
        return `[문서 ${index + 1}] 제목: ${title}\n내용: ${content}`;
      })
      .join('\n\n---\n\n');
    
    // 문서 내용 로깅 (디버깅용)
    console.log(`📄 관련 질문 생성에 사용된 문서 내용 (${documentContents.length}자):`);
    console.log(documentContents.substring(0, 500) + '...');

    // Anthropic API를 사용하여 관련 질문 생성
    if (!anthropic) {
      console.warn('⚠️ Anthropic API가 설정되지 않음. 관련 질문 생성 건너뜀');
      return [];
    }

    // 벤더 정보 추출
    const vendors = vendorFilter && vendorFilter.length > 0 
      ? vendorFilter 
      : Array.from(new Set(searchResults.map(r => r.sourceVendor).filter((v): v is string => Boolean(v))));
    const vendorInfo = vendors.length > 0 
      ? `\n**선택된 벤더:** ${vendors.map(v => getVendorDisplayName(v)).join(', ')}\n` 
      : '';
    
    console.log(`🏷️ 관련 질문 생성 - 벤더: ${vendors.length > 0 ? vendors.join(', ') : '전체'}`);

    // 문서에서 구체적으로 언급된 주제/섹션 추출 (질문 생성 가이드용)
    const documentTopics: string[] = [];
    const documentSections: string[] = [];
    
    // 문서에서 섹션 제목 패턴 추출 (예: "02|네이버페이리워드광고", "프리미엄패키지" 등)
    const sectionPatterns = [
      /(\d{2}\|[가-힣\s]+)/g, // "02|네이버페이리워드광고" 같은 패턴
      /(리워드광고|프리미엄패키지|스마트스토어|포인트구매|증권제휴)/g,
      /(연동형|비연동형|서버연동|수동적립)/g,
      /(최소집행|집행금액|단가|정산|지급시점|지급방법)/g,
    ];
    
    sectionPatterns.forEach(pattern => {
      const matches = documentContents.match(pattern);
      if (matches) {
        documentSections.push(...matches.map(m => m.trim()));
      }
    });
    
    // 문서에서 구체적으로 언급된 주제 추출
    const topicPatterns = [
      /(광고집행방법|광고단가|정산기준|지급방법|지급시점)/g,
      /(연동형|비연동형|서버연동|쿠폰PIN번호)/g,
      /(스마트스토어|프리미엄패키지|포인트구매|증권제휴)/g,
      /(최소집행금액|건단가|적립금|광고비)/g,
    ];
    
    topicPatterns.forEach(pattern => {
      const matches = documentContents.match(pattern);
      if (matches) {
        documentTopics.push(...matches.map(m => m.trim()));
      }
    });
    
    const uniqueSections = Array.from(new Set(documentSections)).slice(0, 8);
    const uniqueTopics = Array.from(new Set(documentTopics)).slice(0, 10);
    
    const sectionsInfo = uniqueSections.length > 0 
      ? `\n**문서에서 발견된 주요 섹션/제목:** ${uniqueSections.join(', ')}\n` 
      : '';
    const topicsInfo = uniqueTopics.length > 0 
      ? `\n**문서에서 발견된 주요 주제:** ${uniqueTopics.join(', ')}\n` 
      : '';
    const keywordsInfo = sectionsInfo + topicsInfo + (sectionsInfo || topicsInfo ? `(위의 섹션이나 주제를 기반으로 질문을 생성하세요. 다른 내용은 사용하지 마세요)\n` : '');

    // 문서에서 실제로 언급된 구체적인 문구 추출 (질문 생성 가이드)
    const specificPhrases: string[] = [];
    
    // 문서에서 구체적으로 언급된 문구 패턴 추출
    const phrasePatterns = [
      /(연동형.*?비연동형|서버연동.*?수동적립)/g,
      /(최소집행금액\d+만원|집행금액\d+만원)/g,
      /(지급시점.*?실시간|지급방법.*?적립)/g,
      /(정산기준.*?정산|단가.*?원)/g,
      /(프리미엄패키지|스마트스토어|포인트구매|증권제휴)/g,
    ];
    
    phrasePatterns.forEach(pattern => {
      const matches = documentContents.match(pattern);
      if (matches) {
        specificPhrases.push(...matches.map(m => m.trim()).filter(m => m.length > 5));
      }
    });
    
    const uniquePhrases = Array.from(new Set(specificPhrases)).slice(0, 8);
    const phrasesInfo = uniquePhrases.length > 0 
      ? `\n**문서에서 발견된 구체적인 문구 (이 문구들을 기반으로 질문 생성):**\n${uniquePhrases.map((p, i) => `${i + 1}. "${p}"`).join('\n')}\n\n위의 문구들 중 하나 이상을 포함하는 질문만 생성하세요.\n` 
      : '';

    const prompt = `당신은 검색된 문서 내용을 기반으로 관련 예측 질문을 생성하는 AI입니다.

**사용자 질문:** ${query}${vendorInfo}

**검색된 문서 내용 (이 내용만을 기반으로 질문 생성):**
${documentContents}${keywordsInfo}${phrasesInfo}

**절대 필수 사항:**
1. **문서 내용만 사용**: 위의 "검색된 문서 내용"에 명시된 내용만을 기반으로 질문을 생성하세요. 문서에 없는 내용에 대한 질문은 절대 생성하지 마세요.
2. **사용자 질문과 직접 관련**: 사용자 질문("${query}")과 직접적으로 관련된 문서 내용만 사용하세요.
3. **벤더 정보 반영**: ${vendors.length > 0 ? `선택된 벤더(${vendors.map(v => getVendorDisplayName(v)).join(', ')})의 문서 내용만 기반으로 질문을 생성하세요.` : '문서에 명시된 벤더 정보를 반영하세요.'}
4. **구체적 내용 인용**: 각 질문은 문서에서 구체적으로 언급된 주제, 기능, 절차, 정책, 수치 등을 직접 인용하여 다뤄야 합니다.
5. **문서의 특정 섹션 참조**: 문서의 특정 섹션(예: "02|네이버페이리워드광고", "프리미엄패키지", "스마트스토어" 등)에서 언급된 내용만 사용하세요.

**절대 금지 사항 (중요 - 반드시 준수):**
- ❌ **인기 키워드 기반 질문 생성 절대 금지**: 
  * "관리자 사용법", "크리에이티브 제작 가이드", "A/B 테스트", "정책 업데이트" 같은 일반적인 FAQ 키워드를 절대 사용하지 마세요.
  * 이런 키워드가 포함된 질문은 문서에 해당 내용이 명시되어 있지 않으면 절대 생성하지 마세요.
- ❌ **일반적인 광고 지식 기반 질문 생성 금지**: 
  * 문서에 명시되지 않은 일반적인 광고 운영 지식(예: "관리자 사용법", "크리에이티브 제작", "A/B 테스트")을 사용하지 마세요.
  * 문서에 없는 기능이나 정책에 대한 질문을 생성하지 마세요.
- ❌ **추측 기반 질문 생성 금지**: 
  * 문서에 명시되지 않은 내용을 추측하여 질문을 생성하지 마세요.
  * "아마도", "일반적으로", "보통" 같은 추측 표현을 사용하지 마세요.
- ❌ **문서 내용과 무관한 질문 생성 금지**: 
  * 문서에 언급되지 않은 주제에 대한 질문을 생성하지 마세요.
  * 사용자 질문("${query}")과 무관한 주제에 대한 질문을 생성하지 마세요.
- ❌ **일반적인 FAQ 패턴 사용 금지**: 
  * "~사용법", "~가이드", "~테스트", "~업데이트" 같은 일반적인 FAQ 패턴을 사용하지 마세요.
  * 문서에 명시된 구체적인 내용만 사용하세요.

**질문 생성 방법 (단계별):**
1. **문서 내용 분석**: 위의 "검색된 문서 내용"을 읽고 사용자 질문("${query}")과 직접 관련된 구체적인 주제를 찾으세요.
2. **구체적 문구 인용**: 문서에서 명시적으로 언급된 문구를 직접 인용하여 질문을 생성하세요.
   - 예: 문서에 "연동형: 서버연동을통한실시간고객적립금지급"이 있으면 → "연동형의 지급 방법은 무엇인가요?"
   - 예: 문서에 "최소집행금액500만원"이 있으면 → "최소 집행 금액은 얼마인가요?"
3. **섹션/표 기반**: 문서의 특정 섹션(예: "02|네이버페이리워드광고", "프리미엄패키지")이나 표에서 언급된 내용만 기반으로 질문을 생성하세요.
4. **문서 문구 직접 사용**: 질문에 사용할 키워드는 반드시 문서에 실제로 나타나는 문구여야 합니다.

**질문 생성 예시 (문서 내용 기반 - 실제 문서에 언급된 내용만):**
${uniquePhrases.length > 0 ? `위의 "문서에서 발견된 구체적인 문구" 중 하나를 기반으로 질문을 생성하세요:\n${uniquePhrases.slice(0, 4).map((phrase, i) => `- "${phrase}" → 이 문구를 기반으로 질문 생성`).join('\n')}\n` : ''}
- 문서에 "연동형/비연동형 집행 방법"이 언급되어 있으면 → "연동형과 비연동형의 차이점은 무엇인가요?"
- 문서에 "최소집행금액500만원"이 언급되어 있으면 → "최소 집행 금액은 얼마인가요?"
- 문서에 "지급시점: 광고참여완료후실시간지급"이 언급되어 있으면 → "리워드 광고의 지급 시점은 언제인가요?"
- 문서에 "스마트스토어 단가: 스토어찜1건당200원"이 언급되어 있으면 → "스마트스토어 스토어찜 단가는 얼마인가요?"

**중요**: 위의 "문서에서 발견된 구체적인 문구" 목록에 있는 문구를 기반으로 질문을 생성하세요. 이 목록에 없는 주제에 대한 질문은 생성하지 마세요.

**출력 형식:**
JSON 배열 형태로 질문만 반환하세요. 설명이나 추가 텍스트 없이 질문만 포함하세요.

예시:
["질문 1", "질문 2", "질문 3", "질문 4"]

위의 검색된 문서 내용을 기반으로 사용자 질문("${query}")과 직접 관련된 예측 질문 4개를 생성하세요.

**최종 확인:**
- 각 질문이 문서에 명시된 구체적인 내용을 다루는가?
- 인기 키워드("관리자", "크리에이티브", "A/B 테스트", "정책 업데이트" 등)를 사용하지 않았는가?
- 문서의 특정 섹션이나 표에서 언급된 내용만 사용했는가?
- 사용자 질문("${query}")과 직접 관련이 있는가?

문서에 명시된 내용만 사용하고, 인기 키워드나 일반적인 FAQ 패턴을 절대 사용하지 마세요:`;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = response.content[0].type === 'text' 
      ? response.content[0].text 
      : '';

    // JSON 배열 파싱
    try {
      // JSON 부분만 추출 (```json ... ``` 형태일 수 있음)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      const jsonText = jsonMatch ? jsonMatch[0] : responseText;
      
      const questions = JSON.parse(jsonText);
      
      if (Array.isArray(questions) && questions.length > 0) {
        // 질문 정리 및 검증
        const validQuestions = questions
          .filter((q: any) => q && typeof q === 'string' && q.trim().length > 10)
          .map((q: string) => q.trim())
          .slice(0, 4); // 최대 4개
        
        console.log(`✅ 관련 질문 생성 완료: ${validQuestions.length}개`);
        console.log(`💡 생성된 질문들:`, validQuestions);
        return validQuestions;
      }
    } catch (parseError) {
      console.warn('⚠️ 관련 질문 JSON 파싱 실패, 텍스트에서 추출 시도:', parseError);
      
      // JSON 파싱 실패 시 텍스트에서 질문 추출
      const lines = responseText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 10 && (line.includes('?') || line.includes('을') || line.includes('를')))
        .slice(0, 4);
      
      if (lines.length > 0) {
        console.log(`✅ 관련 질문 텍스트 추출 완료: ${lines.length}개`);
        return lines;
      }
    }

    return [];
  } catch (error) {
    console.error('❌ 관련 질문 생성 실패:', error);
    return [];
  }
}

/**
 * Claude를 사용한 스트림 답변 생성
 */
async function generateStreamAnswerWithClaude(
  query: string,
  searchResults: SearchResult[],
  controller: ReadableStreamDefaultController
): Promise<string> {
  try {
    console.log('🤖 Claude 스트림 답변 생성 시작');
    console.log('- 질문:', query);
    console.log('- 검색 결과 수:', searchResults.length);
    
    // Claude API가 설정되지 않은 경우 GPT로 fallback 시도
    if (!anthropic) {
      console.log('⚠️ Claude API가 설정되지 않음. GPT로 fallback 시도');
      console.log('🔍 환경변수 확인:', {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '설정됨' : '설정되지 않음',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '설정됨' : '설정되지 않음',
        API_KEY_LENGTH: process.env.ANTHROPIC_API_KEY?.length || 0
      });
      
      if (openai) {
        try {
          return await generateStreamAnswerWithGPT(query, searchResults, controller);
        } catch (gptError) {
          console.error('❌ GPT fallback도 실패:', gptError);
        }
      }
      
      // GPT도 없거나 실패하면 fallback 답변 생성
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
      return fallbackAnswer;
    }
    
    console.log('✅ Claude API 초기화 완료');

    // 벤더 정보 추출 및 동적 프롬프트 생성
    const vendors = extractVendorsFromSearchResults(searchResults);
    console.log(`🏷️ 검색된 벤더: ${vendors.length > 0 ? vendors.join(', ') : '없음'}`);
    
    const prompt = buildMultiVendorPrompt(query, searchResults, vendors);
    
    // 디버깅: 프롬프트에 포함된 컨텍스트 확인
    console.log('📋 프롬프트에 포함된 검색 결과 요약:');
    searchResults.forEach((result, index) => {
      console.log(`  [${index + 1}] ${result.documentTitle}: ${result.content.substring(0, 100)}...`);
    });

    console.log('📝 Claude API 호출 시작');
    let stream;
    try {
      stream = await anthropic.messages.stream({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });
      console.log('✅ Claude API 스트림 시작 완료');
    } catch (apiError) {
      console.error('❌ Claude API 스트림 호출 실패:', apiError);
      console.error('❌ API 에러 상세:', {
        message: apiError instanceof Error ? apiError.message : '알 수 없는 오류',
        stack: apiError instanceof Error ? apiError.stack : undefined,
        name: apiError instanceof Error ? apiError.name : undefined
      });
      console.error('❌ API 키 상태 재확인:', {
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
        keyLength: process.env.ANTHROPIC_API_KEY?.length,
        keyStart: process.env.ANTHROPIC_API_KEY?.substring(0, 10)
      });
      
      // Claude 실패 시 GPT로 fallback 시도
      if (openai) {
        console.log('🔄 Claude 실패 - GPT로 fallback 시도');
        try {
          return await generateStreamAnswerWithGPT(query, searchResults, controller);
        } catch (gptError) {
          console.error('❌ GPT fallback도 실패:', gptError);
          // GPT도 실패하면 fallback 답변 생성
          const fallbackAnswer = generateFallbackAnswer(query, searchResults);
          const words = fallbackAnswer.split(' ');
          for (let i = 0; i < words.length; i++) {
            const chunk = words[i] + (i < words.length - 1 ? ' ' : '');
            const streamResponse = {
              type: 'chunk',
              data: { content: chunk }
            };
            try {
              const chunkData = `data: ${JSON.stringify(streamResponse)}\n\n`;
              controller.enqueue(new TextEncoder().encode(chunkData));
            } catch (jsonError) {
              console.error('❌ Fallback JSON 직렬화 오류:', jsonError);
            }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          return fallbackAnswer;
        }
      } else {
        // GPT도 없으면 fallback 답변 생성
        const fallbackAnswer = generateFallbackAnswer(query, searchResults);
        const words = fallbackAnswer.split(' ');
        for (let i = 0; i < words.length; i++) {
          const chunk = words[i] + (i < words.length - 1 ? ' ' : '');
          const streamResponse = {
            type: 'chunk',
            data: { content: chunk }
          };
          try {
            const chunkData = `data: ${JSON.stringify(streamResponse)}\n\n`;
            controller.enqueue(new TextEncoder().encode(chunkData));
          } catch (jsonError) {
            console.error('❌ Fallback JSON 직렬화 오류:', jsonError);
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return fallbackAnswer;
      }
    }

    let fullAnswer = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const chunkText = event.delta.text;
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
            // JSON 직렬화 시도 (안전한 처리)
            let jsonStr: string;
            try {
              jsonStr = JSON.stringify(streamResponse);
            } catch (stringifyError) {
              console.error('❌ JSON.stringify 실패:', stringifyError);
              // 직렬화 실패 시 간단한 형식으로 재시도
              jsonStr = JSON.stringify({
                type: 'chunk',
                data: { content: chunkText.replace(/[\x00-\x1F\x7F]/g, '') } // 제어 문자 제거
              });
            }
            
            const chunkData = `data: ${jsonStr}\n\n`;
            controller.enqueue(new TextEncoder().encode(chunkData));
          } catch (jsonError) {
            console.error('❌ JSON 직렬화/전송 오류:', jsonError);
            // 최후의 수단: 텍스트만 전송
            try {
              const safeText = chunkText.replace(/[\x00-\x1F\x7F]/g, '');
              const fallbackData = `data: ${JSON.stringify({ type: 'chunk', data: { content: safeText } })}\n\n`;
              controller.enqueue(new TextEncoder().encode(fallbackData));
            } catch (fallbackError) {
              console.error('❌ Fallback 전송도 실패:', fallbackError);
              // 전송 실패는 무시하고 계속 진행
            }
          }
        }
      }
    }

    // 답변 마지막에 상담 추천 문구 추가
    const finalVendors = extractVendorsFromSearchResults(searchResults);
    const vendorName = finalVendors.length > 0 
      ? getVendorDisplayName(finalVendors[0])
      : '벤더';
    
    if (!fullAnswer.includes('추가로 더 자세한 상담') && !fullAnswer.includes('담당자와 직접 상담')) {
      const consultationText = `\n\n추가로 더 자세한 상담이 필요하시다면 ${vendorName} 광고 담당자와 직접 상담하시는 것을 추천드립니다.`;
      fullAnswer += consultationText;
      
      // 상담 문구도 스트림으로 전송
      try {
        const consultationChunk = {
          type: 'chunk',
          data: {
            content: consultationText
          }
        };
        const consultationData = `data: ${JSON.stringify(consultationChunk)}\n\n`;
        controller.enqueue(new TextEncoder().encode(consultationData));
      } catch (error) {
        console.error('❌ 상담 문구 전송 오류:', error);
        // 전송 실패는 무시하고 계속 진행
      }
    }

    console.log(`✅ 스트림 답변 생성 완료: ${fullAnswer.length}자`);
    
    // 스트림 완료 후 usage 정보 가져오기
    try {
      const finalMessage = await stream.finalMessage();
      if (finalMessage.usage) {
        const usage = finalMessage.usage;
        await logApiUsage(
          'claude',
          'claude-3-5-haiku-20241022',
          usage.input_tokens || 0,
          usage.output_tokens || 0,
          usage.input_tokens + usage.output_tokens,
          undefined,
          undefined
        );
      }
    } catch (usageError) {
      console.error('❌ 스트림 usage 정보 가져오기 실패:', usageError);
      // usage 정보 가져오기 실패는 무시
    }
    
    return fullAnswer;
  } catch (error) {
    console.error('❌ Claude 스트림 답변 생성 실패:', error);
    throw error;
  }
}

/**
 * Claude를 사용한 답변 생성
 */
async function generateAnswerWithClaude(
  query: string,
  searchResults: SearchResult[]
): Promise<string> {
  try {
    console.log('🤖 Claude 답변 생성 시작');
    console.log('- 질문:', query);
    console.log('- 검색 결과 수:', searchResults.length);
    
    // Claude API가 설정되지 않은 경우 GPT로 fallback 시도
    if (!anthropic) {
      console.log('⚠️ Claude API가 설정되지 않음. GPT로 fallback 시도');
      if (openai) {
        try {
          return await generateAnswerWithGPT(query, searchResults);
        } catch (gptError) {
          console.error('❌ GPT fallback도 실패:', gptError);
        }
      }
      return generateFallbackAnswer(query, searchResults);
    }
    
    console.log('✅ Claude API 초기화 완료');

    // 벤더 정보 추출 및 동적 프롬프트 생성
    const vendors = extractVendorsFromSearchResults(searchResults);
    console.log(`🏷️ 검색된 벤더: ${vendors.length > 0 ? vendors.join(', ') : '없음'}`);
    
    const prompt = buildMultiVendorPrompt(query, searchResults, vendors);

    console.log('📝 Claude API 호출 시작');
    try {
      const message = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });
      
      let answer = message.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('');
      
      // 답변 마지막에 상담 추천 문구 추가
      const vendors = extractVendorsFromSearchResults(searchResults);
      const vendorName = vendors.length > 0 
        ? getVendorDisplayName(vendors[0])
        : '벤더';
      
      if (!answer.includes('추가로 더 자세한 상담') && !answer.includes('담당자와 직접 상담')) {
        answer += `\n\n추가로 더 자세한 상담이 필요하시다면 ${vendorName} 광고 담당자와 직접 상담하시는 것을 추천드립니다.`;
      }
      
      console.log('✅ Claude API 응답 완료');
      console.log('- 답변 길이:', answer.length);
      console.log('- 답변 미리보기:', answer.substring(0, 100) + '...');
      
      // API 사용량 로깅
      if (message.usage) {
        const usage = message.usage;
        await logApiUsage(
          'claude',
          'claude-3-5-haiku-20241022',
          usage.input_tokens || 0,
          usage.output_tokens || 0,
          usage.input_tokens + usage.output_tokens,
          undefined, // conversationId는 나중에 추가 가능
          undefined  // userId는 나중에 추가 가능
        );
      }
      
      return answer;
    } catch (apiError) {
      console.error('❌ Claude API 호출 실패:', apiError);
      console.error('❌ API 에러 상세:', {
        message: apiError instanceof Error ? apiError.message : '알 수 없는 오류',
        stack: apiError instanceof Error ? apiError.stack : undefined,
        name: apiError instanceof Error ? apiError.name : undefined
      });
      console.error('❌ API 키 상태 재확인:', {
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
        keyLength: process.env.ANTHROPIC_API_KEY?.length,
        keyStart: process.env.ANTHROPIC_API_KEY?.substring(0, 10)
      });
      
      // Claude 실패 시 GPT로 fallback 시도
      if (openai) {
        console.log('🔄 Claude 실패 - GPT로 fallback 시도');
        try {
          return await generateAnswerWithGPT(query, searchResults);
        } catch (gptError) {
          console.error('❌ GPT fallback도 실패:', gptError);
        }
      }
      
      throw apiError;
    }
    
  } catch (error) {
    console.error('Claude API 오류:', error);
    
    // GPT로 fallback 시도
    if (openai) {
      console.log('🔄 Claude 오류 - GPT로 fallback 시도');
      try {
        return await generateAnswerWithGPT(query, searchResults);
      } catch (gptError) {
        console.error('❌ GPT fallback도 실패:', gptError);
      }
    }
    
    // 할당량 초과 오류인 경우 특별 처리
    if (error instanceof Error && error.message && error.message.includes('429')) {
      console.log('⚠️ Claude API 할당량 초과 (429 오류). Fallback 답변 생성');
      return generateFallbackAnswer(query, searchResults);
    }
    
    // 404 모델 오류인 경우
    if (error instanceof Error && error.message && error.message.includes('404')) {
      console.log('⚠️ Claude API 모델을 찾을 수 없음 (404 오류). Fallback 답변 생성');
      return generateFallbackAnswer(query, searchResults);
    }
    
    // 기타 Claude API 오류 시 fallback 답변 생성
    return generateFallbackAnswer(query, searchResults);
  }
}

/**
 * GPT를 사용한 스트림 답변 생성 (보조 LLM)
 */
async function generateStreamAnswerWithGPT(
  query: string,
  searchResults: SearchResult[],
  controller: ReadableStreamDefaultController
): Promise<string> {
  try {
    console.log('🤖 GPT 스트림 답변 생성 시작');
    console.log('- 질문:', query);
    console.log('- 검색 결과 수:', searchResults.length);
    
    if (!openai) {
      throw new Error('OpenAI API가 설정되지 않았습니다.');
    }
    
    // 벤더 정보 추출 및 동적 프롬프트 생성
    const vendors = extractVendorsFromSearchResults(searchResults);
    const prompt = buildMultiVendorPrompt(query, searchResults, vendors);
    
    console.log('📝 GPT API 호출 시작');
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      stream: true,
      max_tokens: 4096,
    });
    
    console.log('✅ GPT API 스트림 시작 완료');
    
    let fullAnswer = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullAnswer += content;
        
        // 스트림 데이터 전송
        const streamResponse = {
          type: 'chunk',
          data: { content }
        };
        
        try {
          const chunkData = `data: ${JSON.stringify(streamResponse)}\n\n`;
          controller.enqueue(new TextEncoder().encode(chunkData));
        } catch (jsonError) {
          console.error('❌ GPT JSON 직렬화/전송 오류:', jsonError);
        }
      }
    }
    
    // 답변 마지막에 상담 추천 문구 추가
    const finalVendors = extractVendorsFromSearchResults(searchResults);
    const vendorName = finalVendors.length > 0 
      ? getVendorDisplayName(finalVendors[0])
      : '벤더';
    
    if (!fullAnswer.includes('추가로 더 자세한 상담') && !fullAnswer.includes('담당자와 직접 상담')) {
      const consultationText = `\n\n추가로 더 자세한 상담이 필요하시다면 ${vendorName} 광고 담당자와 직접 상담하시는 것을 추천드립니다.`;
      fullAnswer += consultationText;
      
      try {
        const consultationChunk = {
          type: 'chunk',
          data: { content: consultationText }
        };
        const consultationData = `data: ${JSON.stringify(consultationChunk)}\n\n`;
        controller.enqueue(new TextEncoder().encode(consultationData));
      } catch (error) {
        console.error('❌ 상담 문구 전송 오류:', error);
      }
    }
    
    console.log(`✅ GPT 스트림 답변 생성 완료: ${fullAnswer.length}자`);
    
    // GPT 스트림 API는 usage 정보를 직접 제공하지 않으므로 추정치 계산
    // 프롬프트 토큰 추정: 프롬프트 길이 / 4 (대략적인 토큰 수)
    // 출력 토큰 추정: 답변 길이 / 4
    const estimatedPromptTokens = Math.ceil(prompt.length / 4);
    const estimatedCompletionTokens = Math.ceil(fullAnswer.length / 4);
    const estimatedTotalTokens = estimatedPromptTokens + estimatedCompletionTokens;
    
    // 추정치 로깅 (정확도는 낮지만 참고용)
    await logApiUsage(
      'gpt',
      'gpt-4o-mini',
      estimatedPromptTokens,
      estimatedCompletionTokens,
      estimatedTotalTokens,
      undefined,
      undefined
    );
    
    return fullAnswer;
  } catch (error) {
    console.error('❌ GPT 스트림 답변 생성 실패:', error);
    throw error;
  }
}

/**
 * GPT를 사용한 답변 생성 (보조 LLM)
 */
async function generateAnswerWithGPT(
  query: string,
  searchResults: SearchResult[]
): Promise<string> {
  try {
    console.log('🤖 GPT 답변 생성 시작');
    console.log('- 질문:', query);
    console.log('- 검색 결과 수:', searchResults.length);
    
    if (!openai) {
      throw new Error('OpenAI API가 설정되지 않았습니다.');
    }
    
    // 벤더 정보 추출 및 동적 프롬프트 생성
    const vendors = extractVendorsFromSearchResults(searchResults);
    const prompt = buildMultiVendorPrompt(query, searchResults, vendors);
    
    console.log('📝 GPT API 호출 시작');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 4096,
    });
    
    let answer = completion.choices[0]?.message?.content || '답변을 생성할 수 없습니다.';
    
    // 답변 마지막에 상담 추천 문구 추가
    const finalVendors = extractVendorsFromSearchResults(searchResults);
    const vendorName = finalVendors.length > 0 
      ? getVendorDisplayName(finalVendors[0])
      : '벤더';
    
    if (!answer.includes('추가로 더 자세한 상담') && !answer.includes('담당자와 직접 상담')) {
      answer += `\n\n추가로 더 자세한 상담이 필요하시다면 ${vendorName} 광고 담당자와 직접 상담하시는 것을 추천드립니다.`;
    }
    
    console.log('✅ GPT API 응답 완료');
    console.log('- 답변 길이:', answer.length);
    
    // API 사용량 로깅
    if (completion.usage) {
      const usage = completion.usage;
      await logApiUsage(
        'gpt',
        'gpt-4o-mini',
        usage.prompt_tokens || 0,
        usage.completion_tokens || 0,
        usage.total_tokens || 0,
        undefined, // conversationId는 나중에 추가 가능
        undefined  // userId는 나중에 추가 가능
      );
    }
    
    return answer;
  } catch (error) {
    console.error('❌ GPT 답변 생성 실패:', error);
    throw error;
  }
}

/**
 * Fallback 답변 생성 (할루시네이션 방지 - 문서 기반만)
 */
function generateFallbackAnswer(query: string, searchResults: SearchResult[]): string {
  // 검색 결과에서 벤더 정보 추출
  const vendors = extractVendorsFromSearchResults(searchResults);
  const vendorNames = vendors.length > 0 
    ? vendors.map(v => getVendorDisplayName(v)).join(', ')
    : '멀티 플랫폼';
  
  // 검색 결과가 있는 경우: 검색된 문서 내용만 사용
  if (searchResults.length > 0) {
    const contextSummary = searchResults
      .map((result, index) => `[출처 ${index + 1}] ${result.content.substring(0, 200)}${result.content.length > 200 ? '...' : ''}`)
      .join('\n\n');
    
    return `죄송합니다. 제공된 문서에서 "${query}"에 대한 구체적인 답변을 찾기 어렵습니다.

**🔍 검색된 관련 문서:**
${contextSummary}

위 문서들에는 질문하신 내용이 명확히 명시되어 있지 않습니다. 더 정확한 답변을 원하시면 ${vendorNames} 광고 담당팀에 직접 문의해주시기 바랍니다.

*이 답변은 검색된 문서를 바탕으로 제공되었습니다. 문서에 없는 정보는 포함하지 않았습니다.*`;
  }
  
  // 검색 결과가 없는 경우: 솔직하게 모른다고 말함
  return `죄송합니다. 제공된 내부 문서에서 "${query}"에 대한 관련 정보를 찾을 수 없습니다.

${vendorNames ? `현재 ${vendorNames} 관련 문서가 등록되지 않았거나, 검색 결과가 없습니다.` : '현재 등록된 문서에서 관련 정보를 찾을 수 없습니다.'}

**📧 더 정확한 답변을 원하시면:**
${vendorNames ? `${vendorNames} 광고 담당팀에 직접 문의해주시면 더 구체적인 답변을 받으실 수 있습니다.` : '담당팀에 직접 문의해주시면 더 구체적인 답변을 받으실 수 있습니다.'}

*제공된 문서에 없는 정보이므로 일반적인 지식이나 추측을 포함하지 않았습니다.*`;
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
  console.log('- ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '설정됨' : '설정되지 않음');
  console.log('- ANTHROPIC_API_KEY 값:', process.env.ANTHROPIC_API_KEY?.substring(0, 10) + '...');
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

    // 벤더 자동 감지 (요청에 vendors가 없으면 질문에서 감지)
    let vendorFilter: string[] | null = null;
    
    if (vendors && Array.isArray(vendors) && vendors.length > 0) {
      // 요청에 벤더가 명시된 경우
      vendorFilter = vendors.map((v: any) => String(v).toUpperCase());
      console.log(`🏷️ 요청에서 벤더 필터 받음: ${vendorFilter.join(', ')}`);
    } else {
      // 질문에서 벤더 자동 감지 (키워드 기반 - 빠르고 안정적)
      console.log('🔍 질문에서 벤더 자동 감지 시작...');
      const lowerMessage = message.toLowerCase();
      const detected: string[] = [];
      
      // 키워드 기반 감지 (우선순위: 명시적 언급 > 암묵적 언급)
      // 한글과 영문 모두 체크
      if (message.includes('네이버') || lowerMessage.includes('naver') || lowerMessage.includes('검색광고')) {
        detected.push('NAVER');
      }
      if (message.includes('카카오') || lowerMessage.includes('kakao') || message.includes('비즈보드')) {
        detected.push('KAKAO');
      }
      if (message.includes('구글') || lowerMessage.includes('google') || lowerMessage.includes('google ads')) {
        detected.push('GOOGLE');
      }
      if (message.includes('트위터') || lowerMessage.includes('twitter') || lowerMessage.includes(' x ') || message.includes('엑스')) {
        detected.push('X(TWITTER)');
      }
      // META 감지: 한글 "메타" 추가, 전환API 관련 키워드도 고려
      if (message.includes('메타') || lowerMessage.includes('meta') || 
          lowerMessage.includes('인스타') || lowerMessage.includes('instagram') || 
          message.includes('페이스북') || lowerMessage.includes('facebook') || 
          lowerMessage.includes('threads') ||
          message.includes('전환API') || message.includes('전환 API') || 
          lowerMessage.includes('conversion api') || lowerMessage.includes('conversionapi')) {
        detected.push('META');
      }
      
      if (detected.length > 0) {
        vendorFilter = detected;
        console.log(`✅ 키워드 기반 벤더 감지 성공: ${vendorFilter.join(', ')}`);
      } else {
        console.log('⚠️ 벤더 감지 결과 없음, 전체 검색 진행');
      }
    }

    // 환경변수 상태 확인
    console.log('🔧 환경변수 상태:');
    console.log('- ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '✅ 설정됨' : '❌ 미설정');
    console.log('- NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ 설정됨' : '❌ 미설정');
    console.log('- SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ 설정됨' : '❌ 미설정');

    console.log(`🚀 RAG 챗봇 응답 생성 시작: "${message}"`);
    if (vendorFilter) {
      console.log(`🏷️ 벤더 필터 적용: ${vendorFilter.join(', ')}`);
    }

    // 1. RAG 검색 (출처 수 제한, 벤더 필터 적용) - 더 많은 결과 가져오기
    let searchResults = await searchSimilarChunks(message, 15, vendorFilter); // 초기 검색은 더 많이 가져옴 (10 -> 15로 증가)
    console.log(`📊 초기 검색 결과: ${searchResults.length}개`);
    
    // 벤더 감지가 실패했지만 검색 결과에서 벤더가 명확한 경우, 벤더 필터 재적용
    if (!vendorFilter && searchResults.length > 0) {
      const resultVendors = new Set<string>();
      searchResults.forEach(r => {
        if (r.sourceVendor) {
          resultVendors.add(r.sourceVendor.toUpperCase());
        }
      });
      
      // 검색 결과의 벤더가 하나로 명확한 경우, 해당 벤더로 필터링하여 재검색
      if (resultVendors.size === 1) {
        const dominantVendor = Array.from(resultVendors)[0];
        console.log(`🔄 검색 결과에서 벤더 자동 감지: ${dominantVendor} - 재검색 진행`);
        searchResults = await searchSimilarChunks(message, 3, [dominantVendor]);
        vendorFilter = [dominantVendor];
      } else if (resultVendors.size > 1) {
        // 여러 벤더가 섞여 있는 경우, 유사도가 높은 상위 결과의 벤더를 우선
        const topVendor = searchResults[0]?.sourceVendor?.toUpperCase();
        if (topVendor) {
          const topVendorCount = searchResults.filter(r => r.sourceVendor?.toUpperCase() === topVendor).length;
          const totalCount = searchResults.length;
          
          // 상위 벤더가 50% 이상을 차지하면 해당 벤더로 필터링
          if (topVendorCount / totalCount >= 0.5) {
            console.log(`🔄 상위 벤더 필터링: ${topVendor} (${topVendorCount}/${totalCount}) - 재검색 진행`);
            searchResults = await searchSimilarChunks(message, 3, [topVendor]);
            vendorFilter = [topVendor];
          }
        }
      }
    }
    
    // 최종 결과 선택: 유사도 우선, 잘린 숫자 패턴 필터링 고려
    // 잘린 숫자 패턴 필터링을 고려하여 더 많은 결과 가져오기
    const finalLimit = 8; // 5 -> 8로 증가 (더 많은 정보 포함)
    
    // 벤더 필터가 있는 경우, 해당 벤더 결과만 유지
    if (vendorFilter && vendorFilter.length > 0) {
      const beforeFilter = searchResults.length;
      searchResults = searchResults.filter(r => {
        const resultVendor = r.sourceVendor?.toUpperCase();
        return vendorFilter.some(vf => vf.toUpperCase() === resultVendor);
      });
      if (beforeFilter !== searchResults.length) {
        console.log(`🔍 벤더 필터 적용: ${beforeFilter}개 → ${searchResults.length}개 (${vendorFilter.join(', ')}만 유지)`);
      }
    }
    
    // 유사도 순으로 정렬하여 상위 결과 선택 (파일/URL 균형보다 유사도 우선)
    searchResults = searchResults
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .slice(0, finalLimit);
    
    // 파일과 URL 통계 로깅
    const urlResults = searchResults.filter(r => r.metadata?.sourceType === 'url' || r.metadata?.documentType === 'url');
    const fileResults = searchResults.filter(r => r.metadata?.sourceType === 'file' || (r.metadata?.documentType && r.metadata.documentType !== 'url'));
    console.log(`📊 최종 검색 결과: 상위 ${searchResults.length}개 (유사도 순, 파일 ${fileResults.length}개 + URL ${urlResults.length}개)`);
    
    // 검색 결과 상세 로그 및 타입별 통계
    if (searchResults.length > 0) {
      // 타입별 통계 계산
      const urlResults = searchResults.filter(r => r.metadata?.sourceType === 'url' || r.metadata?.documentType === 'url');
      const fileResults = searchResults.filter(r => r.metadata?.sourceType === 'file' || (r.metadata?.documentType && r.metadata.documentType !== 'url'));
      
      // 벤더별 통계 계산
      const vendorStats: Record<string, number> = {};
      searchResults.forEach(r => {
        const vendor = r.sourceVendor || 'UNKNOWN';
        vendorStats[vendor] = (vendorStats[vendor] || 0) + 1;
      });
      
      console.log('📋 검색 결과 상세:');
      console.log(`  📊 타입별 통계: URL ${urlResults.length}개, 파일 ${fileResults.length}개 (총 ${searchResults.length}개)`);
      console.log(`  🏷️ 벤더별 통계: ${Object.entries(vendorStats).map(([v, c]) => `${v} ${c}개`).join(', ')}`);
      
      searchResults.forEach((result, index) => {
        const resultType = result.metadata?.sourceType || result.metadata?.documentType || 'unknown';
        const typeLabel = resultType === 'url' ? '🌐 URL' : '📄 파일';
        console.log(`  [${index + 1}] ${typeLabel} - 제목: ${result.documentTitle}, 벤더: ${result.sourceVendor || '없음'}, 유사도: ${result.similarity || 'N/A'}`);
      });
      
      // 타입 불균형 경고
      if (urlResults.length === 0 && fileResults.length > 0) {
        console.log('⚠️ 경고: URL 검색 결과가 없습니다. URL 문서가 검색되지 않았을 수 있습니다.');
      } else if (fileResults.length === 0 && urlResults.length > 0) {
        console.log('⚠️ 경고: 파일 검색 결과가 없습니다. 파일 문서가 검색되지 않았을 수 있습니다.');
      }
      
      // 벤더 불일치 경고 (벤더 필터가 있는데 다른 벤더 결과가 포함된 경우)
      if (vendorFilter && vendorFilter.length > 0) {
        const mismatchedVendors = searchResults.filter(r => 
          r.sourceVendor && !vendorFilter.includes(r.sourceVendor.toUpperCase())
        );
        if (mismatchedVendors.length > 0) {
          console.log(`⚠️ 경고: 벤더 필터(${vendorFilter.join(', ')})와 다른 벤더 결과 ${mismatchedVendors.length}개 포함됨`);
        }
      }
    } else {
      console.log('⚠️ 검색 결과가 없습니다. RAG 검색이 제대로 작동하지 않을 수 있습니다.');
    }

    // 2. 검색 결과가 없거나 유사도가 낮으면 관련 내용 없음 응답
    const hasRelevantResults = searchResults.length > 0 && 
      searchResults.some(result => result.similarity > 0.3); // 유사도 30% 이상인 결과가 있는지 확인
    
    if (!hasRelevantResults) {
      console.log('⚠️ RAG 검색 결과가 없거나 유사도가 낮음. 관련 내용 없음 응답');
      
      // 벤더가 감지되었는데 문서가 없는 경우 벤더별 메시지
      let noDataMessage = "죄송합니다. 제공된 내부 문서에서 관련 정보를 찾을 수 없습니다.";
      
      if (vendorFilter && vendorFilter.length > 0) {
        const vendorName = getVendorDisplayName(vendorFilter[0]);
        noDataMessage = `죄송합니다. ${vendorName} 관련 내부 문서를 찾을 수 없습니다.\n\n현재 ${vendorName} 광고 정책 문서가 등록되지 않았거나, 검색 결과가 없습니다.\n\n📧 **더 정확한 답변을 원하시면:**\n담당팀에 직접 문의해주시면 더 구체적인 답변을 받으실 수 있습니다.`;
      } else {
        noDataMessage = "죄송합니다. 제공된 내부 문서에서 관련 정보를 찾을 수 없습니다.\n\n📧 **더 정확한 답변을 원하시면:**\n담당팀에 직접 문의해주시면 더 구체적인 답변을 받으실 수 있습니다.";
      }
      
      // noDataFound인 경우에도 스트리밍으로 응답
      const stream = new ReadableStream({
        async start(controller) {
          try {
            // noData 메시지를 스트림으로 전송
            const words = noDataMessage.split(' ');
            for (let i = 0; i < words.length; i++) {
              const chunk = words[i] + (i < words.length - 1 ? ' ' : '');
              const streamResponse = {
                type: 'chunk',
                data: {
                  content: chunk
                }
              };
              
              const chunkData = `data: ${JSON.stringify(streamResponse)}\n\n`;
              controller.enqueue(new TextEncoder().encode(chunkData));
              await new Promise(resolve => setTimeout(resolve, 30));
            }
            
            // 최종 메타데이터 전송
            const finalData = {
              type: 'done',
              data: {
                sources: [],
                confidence: 0,
                processingTime: Date.now() - startTime,
                model: 'no-data',
                noDataFound: true,
                showContactOption: true
              }
            };
            
            const finalChunk = `data: ${JSON.stringify(finalData)}\n\n`;
            controller.enqueue(new TextEncoder().encode(finalChunk));
            controller.close();
          } catch (error) {
            console.error('❌ 스트림 생성 오류:', error);
            controller.error(error);
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
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

    // 관련 질문 생성 (비동기로 시작, 스트림 완료 후 사용)
    // 벤더 필터 정보도 전달하여 벤더별 문서 기반 질문 생성
    const relatedQuestionsPromise = searchResults.length > 0 
      ? generateRelatedQuestions(message, searchResults, vendorFilter)
      : Promise.resolve([]);
    
    // 스트리밍 응답 생성
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullAnswer = '';
          
          // Claude 스트림 답변 생성 (fullAnswer를 반환하도록 수정 필요)
          // 임시로 빈 문자열로 시작하고, 스트림에서 수집
          const answerPromise = generateStreamAnswerWithClaude(message, searchResults, controller);
          
          // 스트림 완료 대기
          fullAnswer = await answerPromise;
          
          // 관련 질문 생성 완료 대기
          const relatedQuestions = await relatedQuestionsPromise;
          
          // 스트림 완료 후 최종 메타데이터 전송
          // 담당자 문의 버튼은 항상 표시 (사용자가 추가 정보를 요청할 수 있도록)
          const shouldShowContactOption = true;
          
          console.log(`📊 답변 품질 평가: confidence=${confidence}, shouldShowContactOption=${shouldShowContactOption}`);
          console.log(`💡 관련 질문 생성 완료: ${relatedQuestions.length}개`);
          
          // 최종 메타데이터 전송
          try {
            const finalData = {
              type: 'done',
              data: {
                sources: sources || [],
                confidence: confidence || 0.8,
                processingTime: processingTime || 0,
                model: 'claude-3-5-haiku-20241022',
                noDataFound: false,
                showContactOption: shouldShowContactOption || false,
                relatedQuestions: relatedQuestions || []
              }
            };
            
            // JSON 직렬화 시도
            let jsonStr: string;
            try {
              jsonStr = JSON.stringify(finalData);
            } catch (stringifyError) {
              console.error('❌ 최종 메타데이터 JSON.stringify 실패:', stringifyError);
              // 직렬화 실패 시 최소한의 데이터만 전송
              jsonStr = JSON.stringify({
                type: 'done',
                data: {
                  sources: [],
                  confidence: 0.8,
                  processingTime: processingTime || 0,
                  model: 'claude-3-5-haiku-20241022',
                  noDataFound: false,
                  showContactOption: false,
                  relatedQuestions: []
                }
              });
            }
            
            const finalChunk = `data: ${jsonStr}\n\n`;
            controller.enqueue(new TextEncoder().encode(finalChunk));
            controller.close();
          } catch (error) {
            console.error('❌ 최종 메타데이터 전송 오류:', error);
            // 오류 발생 시에도 스트림 종료
            controller.close();
          }
        } catch (error) {
          console.error('❌ 스트림 생성 오류:', error);
          const errorData = {
            type: 'error',
            data: {
              message: '답변 생성 중 오류가 발생했습니다.',
              error: error instanceof Error ? error.message : '알 수 없는 오류'
            }
          };
          const errorChunk = `data: ${JSON.stringify(errorData)}\n\n`;
          controller.enqueue(new TextEncoder().encode(errorChunk));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
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
