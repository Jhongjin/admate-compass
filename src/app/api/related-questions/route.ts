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
  'Meta 광고 상품 유형과 각 상품 유형에 대한 소재 제작가이드를 알려줘',
  'Google Ads 광고 상품 유형과 각 상품 유형에 대한 소재 제작가이드를 알려줘',
  '네이버 광고 상품 유형과 각 상품 유형에 대한 소재 제작가이드를 알려줘',
  '카카오 광고 상품을 비즈보드, 디스플레이, 동영상, 상품 카탈로그, 메시지, 키워드광고, 브랜드검색, 톡채널검색, 보장형/CPT 기준으로 비교해줘',
];

const COMMERCE_QUESTIONS = [
  '쇼핑몰 광고를 운영할 때 Google 쇼핑, Meta 카탈로그, 네이버 쇼핑검색광고, 카카오 상품 카탈로그를 상품 피드, 소재, 전환 추적, 재고 관리 기준으로 비교해줘',
  '네이버 ADVoost 쇼핑, 쇼핑검색광고, 쇼핑블록을 상품 DB, 소재, 전환 추적, 가격·재고 관리 기준으로 비교해줘',
  '카카오 비즈보드, 상품 카탈로그, 메시지 광고를 쇼핑몰 프로모션 운영 관점에서 언제 선택해야 하는지 정리해줘',
  'Meta 카탈로그와 Google 쇼핑/PMax를 상품 피드, 소재 자동화, 전환 추적, 리타게팅 기준으로 비교해줘',
];

const OPERATIONS_QUESTIONS = [
  '광고 성과가 갑자기 떨어졌을 때 Meta, Google Ads, 네이버, 카카오별로 무엇부터 점검해야 해?',
  'Meta, Google Ads, 네이버, 카카오를 신규 고객 확보와 리타게팅 관점에서 예산 배분 기준, 장단점, 측정 KPI로 비교해줘',
  '광고 소재 심사에서 허위·과장, 랜딩 불일치, 가격·혜택 표현을 매체별로 어떻게 점검해야 해?',
  '다매체 광고 운영 시 전환 태그, Pixel/CAPI, Google tag/GA, 상품 DB, CRM 수신을 어떤 순서로 점검해야 해?',
];

const LEAD_QUESTIONS = [
  'Meta와 Google Ads에서 리드 수집 캠페인을 운영할 때 Instant Form/리드 양식, 웹사이트 전환, CRM 연동, 오프라인 전환 업로드, 리드 품질 관리 기준까지 비교 정리해줘',
  'Meta 광고에서 Instant Form, 웹사이트 전환, 메시지, 전화 리드 캠페인을 언제 선택해야 하는지 비교해줘',
  'Google Ads에서 검색 리드 양식, 웹사이트 전환, PMax 리드 캠페인, 오프라인 전환 가져오기를 실무 운영 기준으로 비교해줘',
  '리드 수집 광고를 운영할 때 리드 수, CPL, 유효 리드율, MQL, SQL, 계약률을 어떻게 나눠서 최적화해야 해?',
];

const NAVER_KAKAO_QUESTIONS = [
  '네이버 광고 상품 유형과 각 상품 유형에 대한 소재 제작가이드를 알려줘',
  '카카오 광고 상품을 비즈보드, 디스플레이, 동영상, 상품 카탈로그, 메시지, 키워드광고, 브랜드검색, 톡채널검색, 보장형/CPT 기준으로 비교해줘',
  '네이버와 카카오 광고 상품 종류와 각 광고 상품 소재 제작 가이드를 검색형, 쇼핑형, 디스플레이형, 메시지형 기준으로 비교해줘',
  '네이버 ADVoost 쇼핑, 치지직 전용 광고, 커뮤니케이션 애드와 카카오 비즈보드, 상품 카탈로그, 톡채널검색을 목적별로 비교해줘',
];

const META_GOOGLE_QUESTIONS = [
  'Meta 광고 상품 유형별로 캠페인 목표, 광고 형식, 게재 위치, 리드/앱/카탈로그 활용 기준까지 실무 관점으로 비교 정리해줘',
  'Google Ads 광고 상품 유형을 검색, 디스플레이, 동영상, PMax, 쇼핑, 앱, 리드 양식 기준으로 비교 정리해줘',
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
    if (mentionsAny(normalized, ['카카오', 'kakao', '비즈보드', '톡채널', '브랜드검색', '키워드광고', 'cpt', '네이버', 'naver', '파워링크', '쇼핑검색', 'advoost', '치지직', '커뮤니케이션'])) {
      buckets.push(NAVER_KAKAO_QUESTIONS, DEFAULT_PRODUCT_GUIDE_QUESTIONS, COMMERCE_QUESTIONS);
    } else if (mentionsAny(normalized, ['meta', '메타', 'facebook', 'instagram', '인스타', '페이스북', 'google', '구글', 'pmax', 'youtube'])) {
      buckets.push(META_GOOGLE_QUESTIONS, DEFAULT_PRODUCT_GUIDE_QUESTIONS, COMMERCE_QUESTIONS);
    } else {
      buckets.push(DEFAULT_PRODUCT_GUIDE_QUESTIONS, NAVER_KAKAO_QUESTIONS, META_GOOGLE_QUESTIONS);
    }
  }

  if (mentionsAny(normalized, ['카카오', 'kakao', '비즈보드', '톡채널', '브랜드검색', '키워드광고', 'cpt'])) {
    buckets.push(NAVER_KAKAO_QUESTIONS, COMMERCE_QUESTIONS, OPERATIONS_QUESTIONS);
  }

  if (mentionsAny(normalized, ['네이버', 'naver', '파워링크', '쇼핑검색', 'advoost', '치지직', '커뮤니케이션'])) {
    buckets.push(NAVER_KAKAO_QUESTIONS, COMMERCE_QUESTIONS, OPERATIONS_QUESTIONS);
  }

  if (mentionsAny(normalized, ['meta', '메타', 'facebook', 'instagram', '인스타', '페이스북'])) {
    buckets.push(META_GOOGLE_QUESTIONS, LEAD_QUESTIONS, COMMERCE_QUESTIONS);
  }

  if (mentionsAny(normalized, ['google', '구글', 'pmax', '검색', '쇼핑', 'youtube', 'lead form', '리드 양식'])) {
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
