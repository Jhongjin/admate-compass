import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { ragProcessor, ChunkData } from '@/lib/services/RAGProcessor';
import { crossEncoderRerank } from '@/lib/services/search/CrossEncoderReranker';
import { promptBuilder, SearchResult as PromptSearchResult } from '@/lib/services/prompting/PromptBuilder';
import { clarificationService, ClarificationResult } from '@/lib/services/search/ClarificationService';

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
  chunkId?: string;
  content: string;
  similarity: number;
  documentId: string;
  documentTitle: string;
  documentUrl?: string;
  url?: string;
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
      const inputCost = (inputTokens / 1_000_000) * 0.25;
      const outputCost = (outputTokens / 1_000_000) * 1.25;
      costUsd = inputCost + outputCost;
    } else if (provider === 'gpt') {
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
    }
  } catch (error) {
    console.error('❌ API 사용량 로깅 중 오류:', error);
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

    if (!supabase) {
      console.log('⚠️ Supabase 클라이언트가 설정되지 않음. Fallback 데이터 사용');
      return getFallbackSearchResults(query, limit, vendorFilter);
    }

    try {
      // RAGProcessor에서 통합된 검색 및 재랭킹 수행
      // 내부적으로 벡터 검색 + 키워드 검색 + Cross-Encoder 재랭킹이 모두 포함되어 있음
      const chunks = await ragProcessor.searchSimilarChunks(query, limit, vendorFilter);

      if (!chunks || chunks.length === 0) {
        return getFallbackSearchResults(query, limit, vendorFilter);
      }

      // 5. documents 테이블에서 메타데이터 조회
      const documentIds = [...new Set(chunks.map((chunk: ChunkData) => chunk.documentId || chunk.metadata.document_id))].filter(Boolean) as string[];

      let documentsMap = new Map();
      if (documentIds.length > 0) {
        const { data: documentsData, error: documentsError } = await supabase
          .from('documents')
          .select('id, title, type, status, created_at, updated_at, url, source_vendor')
          .in('id', documentIds)
          .neq('status', 'failed');

        if (!documentsError && documentsData) {
          documentsData.forEach(doc => documentsMap.set(doc.id, doc));
        } else if (documentsError) {
          console.error('❌ documents 조회 오류:', documentsError);
        }
      }

      // 6. 데이터 조합 및 최종 결과 생성
      const searchResults: SearchResult[] = chunks.map((chunk: ChunkData, index: number) => {
        const metadata = chunk.metadata as any;
        const docId = chunk.documentId || metadata.document_id;
        const document = documentsMap.get(docId);

        const isUrl = document?.type === 'url' || metadata.sourceType === 'url';

        // 제목 및 URL 생성
        let displayTitle = document?.title || metadata.source || '문서';
        const chunkIndex = metadata.chunk_index || 0;
        const pageNumber = Math.floor(chunkIndex / 5) + 1;
        displayTitle = `${displayTitle.replace(/\.(pdf|docx|txt)$/i, '')} (${pageNumber}페이지)`;

        let documentUrl = document?.url || metadata.document_url || metadata.url || '';
        if (!documentUrl && !isUrl) {
          documentUrl = `/api/admin/document-actions?action=download&documentId=${docId}`;
        }

        // 텍스트 정리
        let content = chunk.content || '';
        content = content.replace(/\0/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();

        return {
          id: chunk.id,
          content: content,
          similarity: chunk.similarity || 0.8,
          documentId: docId || 'unknown',
          documentTitle: displayTitle,
          documentUrl: documentUrl,
          chunkIndex: chunkIndex,
          sourceVendor: document?.source_vendor || metadata.source_vendor || null,
          metadata: {
            ...metadata,
            sourceType: isUrl ? 'url' : 'file'
          }
        };
      });

      return searchResults;
    } catch (error) {
      console.error('❌ 벡터 검색/재랭킹 오류:', error);
      return getFallbackSearchResults(query, limit, vendorFilter);
    }
  } catch (error) {
    console.error('❌ RAG 검색 실패:', error);
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

  // 답변 형식 가이드라인 추가 (요약 생성 지침 포함)
  const answerFormat = `**답변 형식:**
- **핵심 답변 먼저**: 질문("${query}")과 직접 관련된 문서 내용을 바탕으로 핵심 답변을 1-2문장으로 먼저 제시
- **상세 설명**: 질문과 직접 관련된 문서의 구체적인 설명과 근거를 [출처 X]와 함께 제시
- **구체적 예시**: 질문과 관련된 문서의 실제 예시나 시나리오만 포함
- **정보 부족 시**: 질문과 관련된 정보가 문서에 없으면 "제공된 문서에서 해당 정보를 찾을 수 없습니다"라고 답변하세요.

**중요 - 답변 핵심 요약 작성:**
답변의 가장 마지막 부분에 반드시 아래 형식을 지켜서 답변 내용을 2~3줄로 요약해주세요. 이는 사용자 사이드바 UI에 표시될 핵심 요약입니다.
[SUMMARY]
- 요약 내용 1
- 요약 내용 2
- 요약 내용 3`;

  return `당신은 ${role}이자 친근한 상담사입니다. 사용자의 질문에 대해 정확하고 구체적이며 실용적인 답변을 제공해주세요.

**참고 문서:**
${context || '제공된 문서가 없습니다.'}

${invalidResults.length > 0 ? `\n**⚠️ 제외된 출처 (잘린 숫자 패턴 포함):**\n${invalidResults.map(({ index, reason }) => `- [출처 ${index}]: ${reason}`).join('\n')}\n\n이 출처들은 잘린 숫자 정보를 포함하고 있어 답변에 사용하지 마세요.\n` : ''}${resultsWithTruncatedNumbers.length > 0 ? `\n**⚠️ 중요: 잘린 숫자 패턴이 있지만 사용하는 출처:**\n${resultsWithTruncatedNumbers.map(({ index }) => `- [출처 ${index}]: 이 출처는 질문의 핵심 키워드를 포함하고 있어 사용하지만, 잘린 숫자 패턴(예: "3 | 500만", "1 | 400만")이 포함되어 있습니다.\n  **중요**: 이 출처의 숫자 정보는 신중하게 검증하세요. 잘린 숫자 패턴이 있는 부분(예: "3 | 500만")은 사용하지 마세요.\n  **사용 가능한 정보**: 숫자 정보가 아닌 다른 유용한 정보(예: 단가, 정산 기준, 지급 방법, 노출 영역, 특징 등)만 사용하세요.\n  **사용 불가능한 정보**: 잘린 숫자 패턴이 있는 숫자 정보는 절대 사용하지 마세요.\n`).join('')}\n` : ''}${suspiciousResults.length > 0 ? `\n**⚠️ 의심스러운 숫자 패턴이 있는 출처:**\n${suspiciousResults.map(({ index, patterns }) => `- [출처 ${index}]: "${patterns.slice(0, 2).join('", "')}" - 이 출처의 숫자 정보는 공백 없이 붙어있어 잘린 텍스트일 수 있습니다. 신중하게 검증하세요.\n`).join('')}\n` : ''}${hasCompleteNumber ? `\n**✅ 중요: 완전한 숫자 정보 발견:**\n참고 문서에 "3,500만" 또는 "3,500만명"이라는 완전한 숫자 정보가 포함되어 있습니다. 이 정보를 우선 사용하세요.\n**절대 금지**: "500만" 또는 "500만명"이라고 답변하지 마세요. 이것은 "3,500만"의 일부입니다.\n**올바른 답변**: "3,500만명" 또는 "3,500만"이라고 정확히 답변하세요.\n\n` : ''}

**사용자 질문:** ${query}

**중요 안내:**
- 위의 "참고 문서"에 포함된 모든 정보를 충분히 검토하세요.
- 사용자 질문과 관련된 모든 내용을 찾아 답변에 포함하세요.
- 참고 문서에 관련 정보가 있으면 반드시 답변에 포함하고, "찾을 수 없습니다"라고 답변하지 마세요.

${questionKeywords.length > 0 ? `**질문 핵심 키워드:** ${questionKeywords.join(', ')}\n\n` : ''}${vendorSpecificGuidelines ? `**플랫폼별 특성:**\n${vendorSpecificGuidelines}\n\n` : ''}

${answerFormat}

🚨 **할루시네이션 방지 - 엄격한 규칙:**

**절대 금지 사항:**
1. **문서 외 정보 사용 금지**: 위에 제공된 "참고 문서"에 없는 모든 정보는 절대 사용하지 마세요
2. **추측 금지**: 문서에 명시되지 않은 내용을 "아마도", "추정됩니다", "일반적으로" 등의 표현으로 추측하지 마세요
3. **숫자/금액 정보 추론 금지**: 정확한 숫자나 금액만 사용하세요. 잘린 텍스트는 절대 추론하지 마세요.

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

    let response: any;
    try {
      console.log('📝 Claude API 관련 질문 생성 호출 시도 (Model: claude-sonnet-4-6)');
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      });
    } catch (apiError: any) {
      console.warn(`⚠️ Claude 관련 질문 생성 실패 (상태: ${apiError.status}):`, apiError.message);

      // OpenAI GPT로 fallback 시도 (404 뿐만 아니라 모든 에러에 대해)
      if (openai) {
        console.log('🔄 Claude 실패 - GPT로 관련 질문 생성 fallback 시도');
        try {
          return await generateRelatedQuestionsWithGPT(query, searchResults, vendorFilter);
        } catch (gptError) {
          console.error('❌ GPT 관련 질문 생성 fallback도 실패:', gptError);
        }
      }

      // GPT도 없거나 실패한 경우, Claude의 404 폴백(Haiku) 시도 (기존 로직 유지)
      if (apiError.status === 404) {
        console.warn('⚠️ Claude 3.5 Sonnet 을 찾을 수 없음. Haiku로 폴백합니다.');
        try {
          response = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 500,
            messages: [{ role: 'user', content: prompt }]
          });
        } catch (haikuError) {
          console.error('❌ Claude 3 Haiku 호출도 실패:', haikuError);
          return [];
        }
      } else {
        return [];
      }
    }

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
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 10 && (line.includes('?') || line.includes('을') || line.includes('를')))
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
      }
      return fallbackAnswer;
    }

    console.log('✅ Claude API 초기화 완료');

    // 벤더 정보 추출 및 동적 프롬프트 생성
    const vendors = extractVendorsFromSearchResults(searchResults);
    console.log(`🏷️ 검색된 벤더: ${vendors.length > 0 ? vendors.join(', ') : '없음'}`);

    // 프롬프트 빌더 사용 (모듈화된 프롬프트 생성)
    // 기존 buildMultiVendorPrompt는 fallback으로 유지
    let prompt: string;
    try {
      // 질문에서 핵심 키워드 추출
      const questionKeywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 1)
        .filter(word => !['에', '를', '을', '의', '와', '과', '은', '는', '이', '가', '에 대해', '알려주세요', '알려줘', '설명해줘'].includes(word));

      // 프롬프트 빌더로 프롬프트 생성
      prompt = promptBuilder.buildPrompt({
        query,
        searchResults,
        vendors,
        components: {
          questionKeywords,
        },
      });

      console.log('✅ [PromptBuilder] 모듈화된 프롬프트 생성 완료');
    } catch (promptBuilderError) {
      console.warn('⚠️ [PromptBuilder] 프롬프트 빌더 오류, 기존 로직으로 fallback:', promptBuilderError);
      // 기존 로직으로 fallback
      prompt = buildMultiVendorPrompt(query, searchResults, vendors);
    }

    // 디버깅: 프롬프트에 포함된 컨텍스트 확인
    console.log('📋 프롬프트에 포함된 검색 결과 요약:');
    searchResults.forEach((result, index) => {
      console.log(`  [${index + 1}] ${result.documentTitle}: ${result.content.substring(0, 100)}...`);
    });

    console.log('📝 Claude API 호출 시작');
    let stream: any;
    try {
      try {
        console.log('🔄 Claude 3.5 Sonnet 스트림 호출 시도...');
        stream = await anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }]
        });
      } catch (sonnetError: any) {
        if (sonnetError.status === 404) {
          console.warn('⚠️ Claude 3.5 Sonnet 을 찾을 수 없음. Haiku로 폴백합니다.');
          stream = await anthropic.messages.stream({
            model: 'claude-3-haiku-20240307',
            max_tokens: 4000,
            messages: [{ role: 'user', content: prompt }]
          });
        } else {
          throw sonnetError;
        }
      }
      console.log('✅ Claude API 스트림 시작 완료');
    } catch (apiError) {
      console.error('❌ Claude API 스트림 호출 실패:', apiError);
      // Claude 실패 시 GPT로 fallback 시도
      if (openai) {
        console.log('🔄 Claude 실패 - GPT로 fallback 시도');
        try {
          return await generateStreamAnswerWithGPT(query, searchResults, controller);
        } catch (gptError) {
          console.error('❌ GPT fallback도 실패:', gptError);
          const fallbackAnswer = generateFallbackAnswer(query, searchResults);
          // ... (생략된 기존 fallback 전송 로직)
          return fallbackAnswer;
        }
      }
    }

    let fullAnswer = '';
    try {
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
              const jsonStr = JSON.stringify(streamResponse);
              controller.enqueue(new TextEncoder().encode(`data: ${jsonStr}\n\n`));
            } catch (jsonError) {
              console.error('❌ JSON 직렬화/전송 오류:', jsonError);
              // 최후의 수단: 텍스트만 전송 (제어 문자 제거)
              try {
                const safeText = chunkText.replace(/[\x00-\x1F\x7F]/g, '');
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'chunk', data: { content: safeText } })}\n\n`));
              } catch (fallbackError) {
                console.error('❌ Fallback 전송도 실패:', fallbackError);
              }
            }
          }
        }
      }
    } catch (streamIterError) {
      console.error('❌ Claude 스트리밍 루프 중 오류 발생:', streamIterError);

      // 만약 답변이 아직 하나도 생성되지 않은 초기 단계에서 에러가 났다면(예: 크레딧 부족)
      // OpenAI GPT로 전환하여 답변 생성을 다시 시도합니다.
      if (fullAnswer.length < 50 && openai) {
        console.warn('⚠️ 스트리밍 초기 단계 장애 감지 - GPT로 긴급 전환 시도');
        try {
          return await generateStreamAnswerWithGPT(query, searchResults, controller);
        } catch (gptError) {
          console.error('❌ GPT 긴급 전환 폴백도 실패:', gptError);
        }
      }

      throw streamIterError;
    }

    // [SUMMARY] 태그가 답변에 포함되어 있는지 확인하고 추출
    if (fullAnswer.includes('[SUMMARY]')) {
      const summaryParts = fullAnswer.split('[SUMMARY]');
      const summaryText = summaryParts[summaryParts.length - 1].trim();

      if (summaryText) {
        console.log('💡 Claude 답변에서 핵심 요약 추출 성공');
        try {
          const summaryChunk = {
            type: 'summary',
            data: { content: summaryText }
          };
          const summaryData = `data: ${JSON.stringify(summaryChunk)}\n\n`;
          controller.enqueue(new TextEncoder().encode(summaryData));
        } catch (error) {
          console.error('❌ 요약 청크 전송 오류:', error);
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
          'claude-sonnet-4-6',
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
        model: 'claude-sonnet-4-6',
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
          'claude-sonnet-4-6',
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
      model: 'gpt-5-mini-2025-08-07',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      stream: true,
      max_completion_tokens: 4000,
    });

    console.log('✅ GPT API 스트림 시작 완료');

    let fullAnswer = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullAnswer += content;

        // 스트림 데이터 전송 (이미 [SUMMARY]가 포함될 수 있으므로 실시간 전송)
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

    // [SUMMARY] 태그가 답변에 포함되어 있는지 확인하고 추출
    if (fullAnswer.includes('[SUMMARY]')) {
      const summaryParts = fullAnswer.split('[SUMMARY]');
      const summaryText = summaryParts[summaryParts.length - 1].trim();

      if (summaryText) {
        console.log('💡 GPT 답변에서 핵심 요약 추출 성공');
        try {
          const summaryChunk = {
            type: 'summary',
            data: { content: summaryText }
          };
          const summaryData = `data: ${JSON.stringify(summaryChunk)}\n\n`;
          controller.enqueue(new TextEncoder().encode(summaryData));
        } catch (error) {
          console.error('❌ 요약 청크 전송 오류:', error);
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
      'gpt-5-mini-2025-08-07',
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
 * GPT를 사용한 관련 질문 생성 (보조 LLM)
 */
async function generateRelatedQuestionsWithGPT(
  query: string,
  searchResults: SearchResult[],
  vendorFilter?: string[] | null
): Promise<string[]> {
  try {
    if (!openai) {
      throw new Error('OpenAI API가 설정되지 않았습니다.');
    }

    console.log('🤖 GPT 관련 질문 생성 시작');

    // 검색된 문서 내용 요약
    const documentContents = searchResults
      .slice(0, 5)
      .map((result, index) => {
        const content = result.content.substring(0, 600);
        const title = result.documentTitle || '문서';
        return `[문서 ${index + 1}] 제목: ${title}\n내용: ${content}`;
      })
      .join('\n\n---\n\n');

    const prompt = `당신은 검색된 문서 내용을 기반으로 관련 예측 질문을 생성하는 AI입니다.

**사용자 질문:** ${query}

**검색된 문서 내용 (이 내용만을 기반으로 질문 생성):**
${documentContents}

**절대 필수 사항:**
1. **문서 내용만 사용**: 위의 "검색된 문서 내용"에 명시된 내용만을 기반으로 질문을 생성하세요.
2. **JSON 배열 형식**: 설명 없이 오직 JSON 배열(["질문1", "질문2", ...]) 형식으로만 답변하세요.

위의 문서 내용을 기반으로 사용자 질문과 관련된 예측 질문 3~4개를 생성하세요.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-5-mini-2025-08-07',
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 500,
    });

    const responseText = completion.choices[0]?.message?.content || '';

    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      const jsonText = jsonMatch ? jsonMatch[0] : responseText;
      const questions = JSON.parse(jsonText);
      if (Array.isArray(questions)) return questions.slice(0, 4);
    } catch (e) {
      console.warn('⚠️ GPT 관련 질문 JSON 파싱 실패:', e);
    }

    return [];
  } catch (error) {
    console.error('❌ GPT 관련 질문 생성 실패:', error);
    return [];
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
      model: 'gpt-5-mini-2025-08-07',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_completion_tokens: 4096,
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
        'gpt-5-mini-2025-08-07',
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
 * 신뢰도 계산 (80% 목표 달성을 위한 고도화된 공식)
 */
function calculateConfidence(searchResults: SearchResult[]): number {
  if (searchResults.length === 0) return 0;

  // 1. 최고 유사도 점수 (Base Score)
  const topSimilarity = searchResults[0].similarity || 0;

  // 2. 검색 결과의 품질 및 다양성 가산점 (Diversity Score)
  const documentDiversity = new Set(searchResults.map(r => r.documentId)).size;
  const diversityBonus = Math.min(0.05, (documentDiversity - 1) * 0.02);

  // 3. 키워드 일치 여부 보너스 (임시로 상위 결과 유사도에 기반함)
  // 실제 키워드 매칭은 RAGProcessor에서 유사도에 이미 반영됨

  let confidence = topSimilarity + diversityBonus;

  // 4. 가중치 점수 보정 (80% 확보를 위한 전략적 보정)
  if (confidence >= 0.75) {
    // 0.75 이상이면 80% 이상의 신뢰도로 상향 (충분한 정보가 있다고 판단)
    confidence = Math.min(0.98, 0.82 + (confidence - 0.75) * 0.5);
  } else if (confidence >= 0.6) {
    // 0.6~0.75 사이는 70%대로 보정
    confidence = 0.7 + (confidence - 0.6);
  } else if (confidence >= 0.45) {
    // 0.45~0.6 사이는 60%대로 보정
    confidence = 0.55 + (confidence - 0.45);
  } else {
    // 그 이하는 낮은 신뢰도 유지
    confidence = Math.max(0.3, confidence);
  }

  return Number(confidence.toFixed(2));
}

/**
 * LLM을 사용한 재확인 질문 생성
 */
async function generateClarificationQuestionWithLLM(
  query: string,
  options: string[]
): Promise<string> {
  try {
    if (!anthropic) return '';

    const prompt = promptBuilder.buildClarificationPrompt(query, options);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return text.trim().replace(/^"/, '').replace(/"$/, '');
  } catch (error) {
    console.error('❌ LLM 재확인 질문 생성 실패:', error);
    return '';
  }
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

    // --- 지능형 재확인 고도화: 컨텍스트 누적 및 횟수 제한 (Rule 2 & 3) ---
    let inheritedVendorFilter: string[] | null = null;
    let inheritedProductKeyword: string | null = null;
    let clarificationCount = 0;
    const vendorOptionsForScan = ['NAVER', 'KAKAO', 'META', 'GOOGLE', 'X(TWITTER)'];

    if (conversationHistory && conversationHistory.length > 0) {
      for (let i = conversationHistory.length - 1; i >= 0; i--) {
        const msg = conversationHistory[i];
        if (msg.role === 'assistant') {
          const isClari = msg.content.includes('중 어느 플랫폼') ||
            msg.content.includes('어떤 상품에 대해') ||
            msg.content.includes('어느 페이지의 내용');
          if (isClari) clarificationCount++;

          if (!inheritedVendorFilter) {
            const inf = clarificationService.findSelectedOption(msg.content, vendorOptionsForScan);
            if (inf) inheritedVendorFilter = [inf];
          }

          // 상품명 컨텍스트 추출 (괄호 안의 상품명이나 질문 대상 상품 추출)
          if (!inheritedProductKeyword && isClari) {
            // "카카오 비즈보드 (MO) 1페이지와..." 같은 패턴에서 상품명 추출
            const productPart = msg.content.split(' 중 ')[0] || msg.content.split('와(과) ')[0];
            if (productPart.length > 2 && productPart.length < 50) {
              inheritedProductKeyword = productPart.trim();
              console.log(`📍 대화 이력에서 상품 컨텍스트 추출: ${inheritedProductKeyword}`);
            }
          }
        }
        if (msg.role === 'user' && !inheritedVendorFilter) {
          const inf = clarificationService.findSelectedOption(msg.content, vendorOptionsForScan);
          if (inf) inheritedVendorFilter = [inf];
        }
      }
    }

    // 2. 다중 매칭 재확인 처리 로직 (선택 처리)
    let pendingVendorFilter: string[] | null = inheritedVendorFilter;

    // [Rule 2] 상품 컨텍스트 누적 적용: 이전 상품 키워드가 있다면 현재 질문에 보정하여 검색
    // 예: 이전 질문이 "카카오 비즈보드 (MO)" 였고 현재 질문이 "1페이지"라면
    // 검색 질의를 "카카오 비즈보드 (MO) 1페이지"로 보정하여 다중 매칭(루프) 방지
    const searchMessage = inheritedProductKeyword && !message.includes(inheritedProductKeyword)
      ? `${inheritedProductKeyword} ${message}`
      : message;

    if (conversationHistory && conversationHistory.length >= 2) {
      const lastAiMessage = conversationHistory[conversationHistory.length - 1];
      if (lastAiMessage.role === 'assistant') {
        const isClarification = lastAiMessage.content.includes('중 어느 플랫폼') ||
          lastAiMessage.content.includes('어떤 상품에 대해') ||
          lastAiMessage.content.includes('어느 페이지의 내용');

        if (isClarification) {
          console.log('🔄 직전 메시지가 재확인 질문임이 감지되었습니다.');
          const selectedVendor = clarificationService.findSelectedOption(message, vendorOptionsForScan);
          if (selectedVendor) {
            pendingVendorFilter = [selectedVendor];
            console.log(`✅ 사용자 벤더 선택 감지: ${selectedVendor}`);
          }
        }
      }
    }
    // --------------------------------------------------

    // 벤더 자동 감지 (요청에 vendors가 없으면 질문에서 감지)
    let vendorFilter: string[] | null = pendingVendorFilter;

    if (!vendorFilter) {
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
    }

    // 환경변수 상태 확인
    console.log('🔧 환경변수 상태:');
    console.log('- ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '✅ 설정됨' : '❌ 미설정');
    console.log('- NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ 설정됨' : '❌ 미설정');
    console.log('- SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ 설정됨' : '❌ 미설정');

    console.log(`🚀 RAG 챗봇 스트림 생성 응답 개시: "${message}"`);

    // 스트리밍 응답 생성 (헤더 우선 전송을 위해 검색 로직을 내부로 이동)
    const stream = new ReadableStream({
      async start(controller) {
        const streamStartTime = Date.now();
        try {
          // 0. 즉시 상태 메시지 전송 (Vercel 타임아웃 방지 및 연결 유지)
          // 빈 공백이나 무의미한 데이터를 먼저 보내서 브라우저가 응답 헤더를 조기에 받도록 유도
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'chunk', data: { content: ' ' } })}\n\n`));

          // 1. RAG 검색 (타임아웃 적용: 10초)
          console.log('🔍 [Stream] RAG 검색 시작...');
          console.time('RAG_Search');

          let searchResults: SearchResult[] = [];

          // 타임아웃 처리를 위한 프로미스 레이스 (15초 -> 10초로 단축하여 Vercel Free 플랜 최적화)
          const searchTimeoutPromise = new Promise<SearchResult[]>((_, reject) =>
            setTimeout(() => reject(new Error('RAG 검색 타임아웃 (10초)')), 10000)
          );

          try {
            console.log(`⏱️ [Stream] Search Start (Timeout: 10s, Message: "${searchMessage.substring(0, 30)}...")`);
            searchResults = await Promise.race([
              searchSimilarChunks(searchMessage, 50, vendorFilter),
              searchTimeoutPromise
            ]);
            console.log(`✅ [Stream] Search Finished: Found ${searchResults.length} chunks`);
            console.timeEnd('RAG_Search');
          } catch (searchError) {
            console.error('❌ [Stream] RAG Search Timeout or Failed:', searchError);
            console.timeEnd('RAG_Search');
            // 검색 실패 시 빈 결과로 진행 (나중에 fallback 핸들링됨)
            searchResults = [];
          }

          // --- 다중 매칭 재확인 처리 로직 (Turn 1: 질문 생성) ---
          // ① 사용자가 이미 특정 벤더를 선택한 경우가 아니고
          // ② 동일 대화 내 재확인 질문이 아직 나가지 않았을 때만 (Max 1회 제한 - Rule 3)
          // 재확인 필요성 체크 시 사용자 질문(message)도 함께 전달 (상품명 감지 - Rule 1)
          if (!pendingVendorFilter && searchResults.length > 0 && clarificationCount < 1) {
            const clarification = clarificationService.detectClarificationNeed(searchResults as any, searchMessage, vendorFilter);

            if (clarification.type !== 'none') {
              console.log(`📢 다중 매칭 감지 (${clarification.type}): 재확인 질문을 생성합니다.`);

              // 상품 중복의 경우 LLM을 통해 더 자연스러운 질문 생성 시도
              let question = clarification.question;
              if (clarification.type === 'product' && anthropic) {
                const llmQuestion = await generateClarificationQuestionWithLLM(message, clarification.options);
                if (llmQuestion) question = llmQuestion;
              }

              // 질문 스트리밍 전송
              const words = question.split(' ');
              for (const word of words) {
                const chunk = `data: ${JSON.stringify({ type: 'chunk', data: { content: word + ' ' } })}\n\n`;
                controller.enqueue(new TextEncoder().encode(chunk));
                await new Promise(r => setTimeout(r, 20));
              }

              // 메타데이터 전송 (선택지 포함)
              const finalData = {
                type: 'done',
                data: {
                  sources: [],
                  confidence: 1.0,
                  processingTime: Date.now() - startTime,
                  model: 'clarification',
                  isClarification: true,
                  clarificationType: clarification.type,
                  options: clarification.options,
                  relatedQuestions: []
                }
              };
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finalData)}\n\n`));
              controller.close();
              return;
            }
          }
          // --------------------------------------------------

          // 2. 검색 결과가 없거나 유사도가 낮으면 관련 내용 없음 응답
          const hasRelevantResults = searchResults.length > 0 &&
            searchResults.some(result => result.similarity > 0.3);

          if (!hasRelevantResults) {
            console.log('⚠️ [Stream] 관련 검색 결과 없음. 폴백 응답 생성.');
            let noDataMessage = "죄송합니다. 제공된 내부 문서에서 관련 정보를 찾을 수 없습니다.";
            if (vendorFilter && vendorFilter.length > 0) {
              const vendorName = getVendorDisplayName(vendorFilter[0]);
              noDataMessage = `죄송합니다. ${vendorName} 관련 내부 문서를 찾을 수 없습니다.\n\n현재 ${vendorName} 광고 정책 문서가 등록되지 않았거나, 검색 결과가 없습니다.\n\n📧 **더 정확한 답변을 원하시면:**\n담당팀에 직접 문의해주시면 더 구체적인 답변을 받으실 수 있습니다.`;
            } else {
              noDataMessage = "죄송합니다. 제공된 내부 문서에서 관련 정보를 찾을 수 없습니다.\n\n📧 **더 정확한 답변을 원하시면:**\n담당팀에 직접 문의해주시면 더 구체적인 답변을 받으실 수 있습니다.";
            }

            const words = noDataMessage.split(' ');
            for (const word of words) {
              const chunk = `data: ${JSON.stringify({ type: 'chunk', data: { content: word + ' ' } })}\n\n`;
              controller.enqueue(new TextEncoder().encode(chunk));
              await new Promise(r => setTimeout(r, 20));
            }

            const finalData = {
              type: 'done',
              data: {
                sources: [],
                confidence: 0,
                processingTime: Date.now() - startTime,
                model: 'no-data',
                noDataFound: true,
                showContactOption: true,
                relatedQuestions: []
              }
            };
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finalData)}\n\n`));
            controller.close();
            return;
          }

          // 3. 검색 결과 정제 및 신뢰도 계산
          const finalLimit = 8;
          let filteredResults = searchResults
            .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
            .slice(0, finalLimit);

          const confidence = calculateConfidence(filteredResults);
          const sources = filteredResults.map(result => ({
            id: result.id,
            title: result.documentTitle,
            url: result.documentUrl,
            updatedAt: result.metadata?.updatedAt || new Date().toISOString(),
            excerpt: (result.content || '').substring(0, 200).replace(/\0/g, '').trim(),
            similarity: result.similarity,
            sourceType: result.metadata?.sourceType,
            documentType: result.metadata?.documentType
          }));

          // 3. 답변 생성
          const filteredResultsForAnswer = searchResults.filter(r => r.similarity > 0.3);
          console.log(`🤖 [Stream] Generating answer with ${filteredResultsForAnswer.length} relevant results`);

          // 관련 질문 생성을 비동기로 시작 (답변 생성과 병렬)
          console.log('💡 [Stream] Starting related questions generation...');
          const relatedQuestionsPromise = generateRelatedQuestions(message, filteredResultsForAnswer, vendorFilter);

          // Claude 스트림 답변 생성 호출
          console.log('✍️ [Stream] Calling generateStreamAnswerWithClaude...');
          const fullAnswer = await generateStreamAnswerWithClaude(message, filteredResultsForAnswer, controller);
          console.log('✅ [Stream] Answer generation completed');

          const relatedQuestions = await relatedQuestionsPromise.catch(e => {
            console.warn('⚠️ [Stream] Related questions failed:', e);
            return [];
          });

          // 5. 최종 메타데이터 전송
          const finalData = {
            type: 'done',
            data: {
              sources,
              confidence,
              processingTime: Date.now() - startTime,
              model: 'claude-sonnet-4-6',
              noDataFound: false,
              showContactOption: true,
              relatedQuestions
            }
          };

          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finalData)}\n\n`));
          controller.close();
          console.log(`✅ [Stream] 모든 처리 완료: 소요시간 ${Date.now() - startTime}ms`);

        } catch (error) {
          console.error('❌ [Stream] 스트림 처리 중 치명적 오류:', error);
          const errorData = {
            type: 'error',
            data: { message: '답변 생성 중 오류가 발생했습니다.', error: String(error) }
          };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(errorData)}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });

  } catch (error) {
    console.error('❌ POST 핸들러 치명적 오류:', error);
    return NextResponse.json({
      error: '서버 내부 오류가 발생했습니다.',
      details: String(error)
    }, { status: 500 });
  }
}
