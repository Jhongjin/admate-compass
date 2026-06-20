const supportedVendorTerms = [
  'meta',
  'facebook',
  '페이스북',
  'instagram',
  '인스타그램',
  'kakao',
  '카카오',
  'naver',
  '네이버',
  'google',
  '구글',
  'youtube',
  '유튜브',
  'gdn',
];

const adPolicyTerms = [
  '광고',
  '정책',
  '심사',
  '소재',
  '매체',
  '캠페인',
  '타겟',
  '집행',
  '승인',
  '반려',
  ...supportedVendorTerms,
];

const policyStandardTerms = [
  '심사 기준',
  '심사',
  '기준',
  '정책',
  '가이드',
  '규정',
  '승인',
  '반려',
];

const impossibleDomainTerms = [
  '화성 거주',
  '거주용 산소',
  '산소 농장',
  '우주 식민',
  '우주 거주',
  '외계',
  '달 거주',
  '테라포밍',
  '초공간',
  'mars colony',
  'oxygen farm',
];

const productStructureTerms = [
  '광고 상품',
  '광고상품',
  '상품',
  '종류',
  '유형',
  '구조',
  '캠페인',
];

const futureLaunchTerms = [
  '출시될',
  '출시 예정',
  '출시예정',
  '공개될',
  '도입될',
  '예정인',
  '미래',
  'future',
  'upcoming',
];

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePolicyQuery(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text
 * @param {string[]} terms
 * @returns {string[]}
 */
function matchTerms(text, terms) {
  return terms.filter((term) => text.includes(term));
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasKnownVendor(text) {
  return supportedVendorTerms.some((term) => text.includes(term));
}

/**
 * @param {string} text
 * @returns {number[]}
 */
function extractYears(text) {
  return Array.from(text.matchAll(/(^|[^\d])(\d{4})\s*(년|year)?(?!\d)/g))
    .map((match) => Number(match[2]))
    .filter((year) => Number.isFinite(year));
}

/**
 * @param {string} text
 * @returns {string | null}
 */
function detectUnsupportedPlatformLikeTarget(text) {
  if (hasKnownVendor(text)) return null;

  const englishAdsMatch = text.match(/\b([a-z][a-z0-9-]{2,}(?:\s+[a-z][a-z0-9-]{2,})?)\s+ads?\b/);
  if (!englishAdsMatch) return null;

  const candidate = englishAdsMatch[1].trim();
  if (!candidate || supportedVendorTerms.some((term) => candidate.includes(term))) {
    return null;
  }

  return candidate;
}

/**
 * Detects a narrow class of policy targets where Compass should not attach generic
 * policy sources: impossible future standards and unsupported platform standards.
 *
 * @param {unknown} query
 * @param {{ currentYear?: number }} [options]
 * @returns {{
 *   isUnavailablePolicyTarget: boolean,
 *   reason?: 'future_impossible' | 'fictional_platform',
 *   matchedTerms: string[],
 *   farFutureYears: number[],
 *   unsupportedPlatform?: string
 * }}
 */
export function detectUnavailablePolicyTarget(query, options = {}) {
  const text = normalizePolicyQuery(query);
  const matchedAdPolicyTerms = matchTerms(text, adPolicyTerms);
  if (matchedAdPolicyTerms.length === 0) {
    return {
      isUnavailablePolicyTarget: false,
      matchedTerms: [],
      farFutureYears: [],
    };
  }

  const matchedPolicyStandardTerms = matchTerms(text, policyStandardTerms);
  const asksForPolicyStandard = matchedPolicyStandardTerms.length > 0;

  const currentYear = Number.isFinite(options.currentYear)
    ? Number(options.currentYear)
    : new Date().getFullYear();
  const farFutureThreshold = Math.max(2100, currentYear + 50);
  const years = extractYears(text);
  const farFutureYears = years.filter((year) => year >= farFutureThreshold);
  const matchedImpossibleDomainTerms = matchTerms(text, impossibleDomainTerms);
  const matchedProductStructureTerms = matchTerms(text, productStructureTerms);
  const matchedFutureLaunchTerms = matchTerms(text, futureLaunchTerms);
  const marsWithImpossibleContext = text.includes('화성')
    && (text.includes('거주용') || text.includes('산소 농장') || text.includes('우주'));

  const speculativeFutureKnownVendorProduct = hasKnownVendor(text)
    && years.some((year) => year > currentYear + 1)
    && matchedProductStructureTerms.length > 0
    && (matchedFutureLaunchTerms.length > 0 || matchedImpossibleDomainTerms.length > 0);

  if (
    farFutureYears.length > 0
    || matchedImpossibleDomainTerms.length > 0
    || marsWithImpossibleContext
    || speculativeFutureKnownVendorProduct
  ) {
    return {
      isUnavailablePolicyTarget: true,
      reason: 'future_impossible',
      matchedTerms: [
        ...matchedAdPolicyTerms,
        ...matchedPolicyStandardTerms,
        ...matchedImpossibleDomainTerms,
        ...matchedProductStructureTerms,
        ...matchedFutureLaunchTerms,
      ],
      farFutureYears: farFutureYears.length > 0 ? farFutureYears : years.filter((year) => year > currentYear + 1),
    };
  }

  if (!asksForPolicyStandard) {
    return {
      isUnavailablePolicyTarget: false,
      matchedTerms: matchedAdPolicyTerms,
      farFutureYears: [],
    };
  }

  const unsupportedPlatform = detectUnsupportedPlatformLikeTarget(text);
  if (unsupportedPlatform) {
    return {
      isUnavailablePolicyTarget: true,
      reason: 'fictional_platform',
      matchedTerms: [
        ...matchedAdPolicyTerms,
        ...matchedPolicyStandardTerms,
        unsupportedPlatform,
      ],
      farFutureYears: [],
      unsupportedPlatform,
    };
  }

  return {
    isUnavailablePolicyTarget: false,
    matchedTerms: matchedAdPolicyTerms,
    farFutureYears: [],
  };
}
