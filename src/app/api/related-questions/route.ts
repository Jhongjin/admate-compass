import { NextRequest, NextResponse } from 'next/server';

const RELATED_QUESTION_LIMIT = 4;

const REGULATED_SCOPE_HINTS = [
  '병원',
  '의료',
  '의약품',
  '건강기능식품',
  '금융',
  '대출',
  '보험',
  '투자',
  '주류',
  '담배',
  '성인',
  '도박',
];

const DEFAULT_PRODUCT_GUIDE_QUESTIONS = [
  'Meta 광고 상품은 어떤 기준으로 고르면 돼?',
  'Google Ads 검색광고는 어떤 상황에서 먼저 쓰는 게 좋아?',
  '네이버 쇼핑검색광고는 어떤 상황에서 쓰는 게 좋아?',
  '카카오 비즈보드는 어떤 상황에서 쓰는 게 좋아?',
];

const COMMERCE_QUESTIONS = [
  '쇼핑몰 광고를 시작할 때 상품 피드는 무엇부터 준비해야 해?',
  '네이버 쇼핑검색광고 등록 전에 상품 DB에서 뭘 확인해야 해?',
  'Meta 카탈로그 광고는 어떤 상황에서 쓰는 게 좋아?',
  '카카오 상품 카탈로그 광고는 어떤 구조로 운영돼?',
];

const OPERATIONS_QUESTIONS = [
  '광고 성과가 갑자기 떨어졌을 때 무엇부터 점검해야 해?',
  '예산을 늘리기 전에 어떤 지표를 확인해야 해?',
  '전환 추적이 맞는지 어떻게 점검해?',
  '소재 심사 반려가 반복될 때 무엇부터 확인해?',
];

const LEAD_QUESTIONS = [
  '리드 광고를 시작할 때 랜딩과 양식 중 무엇을 고르면 좋아?',
  'Meta Instant Form은 어떤 상황에서 쓰는 게 좋아?',
  'Google Ads 리드 양식은 어떤 상황에서 써?',
  '리드 수집 광고를 운영할 때 리드 수, CPL, 유효 리드율, MQL, SQL, 계약률을 어떻게 나눠서 최적화해야 해?',
];

const KAKAO_PRODUCT_QUESTIONS = [
  '카카오 비즈보드는 어떤 상황에서 쓰는 게 좋아?',
  '카카오 비즈보드 소재를 만들 때 무엇을 확인해야 해?',
  '카카오톡 채널 메시지는 언제 쓰는 게 좋아?',
  '카카오 상품 카탈로그 광고는 어떤 구조로 운영돼?',
];

const NAVER_PRODUCT_QUESTIONS = [
  '네이버 쇼핑검색광고는 어떤 상황에서 쓰는 게 좋아?',
  '쇼핑검색광고 등록 전에 상품 DB에서 뭘 확인해야 해?',
  '네이버 파워링크는 어떤 키워드에 먼저 쓰면 좋아?',
  '쇼핑검색광고가 노출되지 않을 때 무엇부터 점검해?',
];

const NAVER_KAKAO_QUESTIONS = [
  ...NAVER_PRODUCT_QUESTIONS.slice(0, 2),
  ...KAKAO_PRODUCT_QUESTIONS.slice(0, 2),
];

const META_GOOGLE_QUESTIONS = [
  'Meta 앱 설치 광고는 어떤 상황에서 쓰는 게 좋아?',
  'Meta 카탈로그 광고는 어떤 구조로 운영돼?',
  'Google Ads 검색광고는 언제 먼저 쓰는 게 좋아?',
  'Google Ads 리드 양식은 어떤 상황에서 써?',
  ...LEAD_QUESTIONS.slice(0, 2),
];

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: '메시지가 필요합니다.' },
        { status: 400 },
      );
    }

    const questions = buildCoverageAwareRelatedQuestions(message);
    console.log(`관련 질문 ${questions.length}개 추천: "${message}"`);

    return NextResponse.json({ relatedQuestions: questions });
  } catch (error) {
    console.error('관련 질문 추천 오류:', error);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}

function buildCoverageAwareRelatedQuestions(message: string): string[] {
  const normalized = normalizeQuestionText(message);
  const buckets: string[][] = [];
  const isOperationsQuestion = mentionsAny(normalized, ['성과', '떨어', '급락', '예산', '리타겟', 'kpi', '입찰', '점검']);
  const isLeadQuestion = mentionsAny(normalized, ['리드', '상담', 'crm', 'mql', 'sql', '계약', '오프라인 전환']);
  const isCommerceQuestion = mentionsAny(normalized, ['쇼핑몰', '커머스', '상품 db', '카탈로그', '피드', '재고', '가격', '구매', '쇼핑검색', '쇼핑']);
  const isProductGuideQuestion = mentionsAny(normalized, ['소재', '제작', '가이드', '상품 유형', '상품 종류', '상품명']);
  const mentionsKakao = mentionsAny(normalized, ['카카오', 'kakao', '비즈보드', '톡채널', '브랜드검색', '키워드광고', 'cpt']);
  const mentionsNaver = mentionsAny(normalized, ['네이버', 'naver', '파워링크', '쇼핑검색', 'advoost', '치지직', '커뮤니케이션']);
  const mentionsMeta = mentionsAny(normalized, ['meta', '메타', 'facebook', 'instagram', '인스타', '페이스북']);
  const mentionsGoogle = mentionsAny(normalized, ['google', '구글', 'google ads', 'pmax', 'youtube', 'lead form', '리드 양식']);

  if (mentionsKakao && !mentionsNaver) {
    buckets.push(KAKAO_PRODUCT_QUESTIONS);
  } else if (mentionsNaver && !mentionsKakao) {
    buckets.push(NAVER_PRODUCT_QUESTIONS);
  } else if (mentionsKakao && mentionsNaver) {
    buckets.push(NAVER_KAKAO_QUESTIONS);
  }

  if (isOperationsQuestion) {
    buckets.push(OPERATIONS_QUESTIONS, LEAD_QUESTIONS, COMMERCE_QUESTIONS);
  }

  if (isLeadQuestion) {
    buckets.push(LEAD_QUESTIONS, OPERATIONS_QUESTIONS);
  }

  if (isCommerceQuestion) {
    buckets.push(COMMERCE_QUESTIONS, DEFAULT_PRODUCT_GUIDE_QUESTIONS);
  }

  if (isProductGuideQuestion) {
    if (mentionsKakao && !mentionsNaver) {
      buckets.push(KAKAO_PRODUCT_QUESTIONS, COMMERCE_QUESTIONS);
    } else if (mentionsNaver && !mentionsKakao) {
      buckets.push(NAVER_PRODUCT_QUESTIONS, COMMERCE_QUESTIONS);
    } else if (mentionsKakao || mentionsNaver) {
      buckets.push(NAVER_KAKAO_QUESTIONS, DEFAULT_PRODUCT_GUIDE_QUESTIONS, COMMERCE_QUESTIONS);
    } else if (mentionsMeta || mentionsGoogle) {
      buckets.push(META_GOOGLE_QUESTIONS, DEFAULT_PRODUCT_GUIDE_QUESTIONS, COMMERCE_QUESTIONS);
    } else {
      buckets.push(DEFAULT_PRODUCT_GUIDE_QUESTIONS, NAVER_KAKAO_QUESTIONS, META_GOOGLE_QUESTIONS);
    }
  }

  if (mentionsKakao) {
    buckets.push(KAKAO_PRODUCT_QUESTIONS, COMMERCE_QUESTIONS, OPERATIONS_QUESTIONS);
  }

  if (mentionsNaver) {
    buckets.push(NAVER_PRODUCT_QUESTIONS, COMMERCE_QUESTIONS, OPERATIONS_QUESTIONS);
  }

  if (mentionsMeta) {
    buckets.push(META_GOOGLE_QUESTIONS, LEAD_QUESTIONS, COMMERCE_QUESTIONS);
  }

  if (mentionsGoogle) {
    buckets.push(META_GOOGLE_QUESTIONS, LEAD_QUESTIONS, COMMERCE_QUESTIONS);
  }

  if (buckets.length === 0) {
    buckets.push(DEFAULT_PRODUCT_GUIDE_QUESTIONS, COMMERCE_QUESTIONS, OPERATIONS_QUESTIONS);
  }

  return takeDiverseQuestions(buckets.flat(), normalized);
}

function takeDiverseQuestions(candidates: string[], currentQuestion: string): string[] {
  const unique: string[] = [];
  const currentCompact = compactQuestion(currentQuestion);

  for (const candidate of candidates) {
    const compact = compactQuestion(candidate);
    if (compact === currentCompact) continue;
    if (isUnsafeDefaultRecommendation(candidate, currentQuestion)) continue;
    if (isOverBroadRecommendation(candidate)) continue;
    if (!unique.some((question) => compactQuestion(question) === compact)) {
      unique.push(candidate);
    }
    if (unique.length >= RELATED_QUESTION_LIMIT) break;
  }

  return unique;
}

function isUnsafeDefaultRecommendation(candidate: string, currentQuestion: string): boolean {
  const currentMentionsRegulatedScope = REGULATED_SCOPE_HINTS.some((hint) => currentQuestion.includes(hint));
  if (currentMentionsRegulatedScope) return false;
  return REGULATED_SCOPE_HINTS.some((hint) => candidate.includes(hint));
}

function isOverBroadRecommendation(candidate: string): boolean {
  const normalized = normalizeQuestionText(candidate);
  const vendorMentionCount = countVendorMentions(normalized);
  const commaCount = (candidate.match(/,/g) || []).length;

  if (vendorMentionCount >= 2 && /비교|매체별|각\s*매체|기준|관점|정리/.test(normalized)) return true;
  if (commaCount >= 3 && /비교|정리|기준/.test(normalized)) return true;
  return false;
}

function countVendorMentions(text: string): number {
  return [
    ['meta', '메타', 'facebook', 'instagram', '인스타', '페이스북'],
    ['google', '구글', 'google ads', 'pmax', 'youtube'],
    ['네이버', 'naver'],
    ['카카오', 'kakao'],
  ].filter((vendorTerms) => mentionsAny(text, vendorTerms)).length;
}

function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactQuestion(text: string): string {
  return normalizeQuestionText(text).replace(/[\s,./!?·:;|()[\]{}_-]+/g, '');
}

function mentionsAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle.toLowerCase()));
}
