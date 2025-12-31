/**
 * 벤더 감지 유틸리티
 * URL을 기반으로 크롤링 대상 벤더를 감지
 */

export type VendorType = 'NAVER' | 'META' | 'KAKAO' | 'GOOGLE' | 'X(TWITTER)' | 'UNKNOWN';

/**
 * URL을 기반으로 벤더 타입 감지
 * @param url 크롤링 대상 URL
 * @returns 감지된 벤더 타입
 */
export function detectVendorFromUrl(url: string): VendorType {
  const lowerUrl = url.toLowerCase();

  // NAVER
  if (lowerUrl.includes('ads.naver.com') || 
      lowerUrl.includes('naver.com/help') ||
      lowerUrl.includes('naver.com/notice')) {
    return 'NAVER';
  }

  // META
  if (lowerUrl.includes('facebook.com') || 
      lowerUrl.includes('instagram.com') ||
      lowerUrl.includes('meta.com') ||
      lowerUrl.includes('threads.net')) {
    return 'META';
  }

  // KAKAO
  if (lowerUrl.includes('kakao.com') || 
      lowerUrl.includes('bizboard.kakao.com')) {
    return 'KAKAO';
  }

  // GOOGLE
  if (lowerUrl.includes('google.com') || 
      lowerUrl.includes('googleads.com') ||
      lowerUrl.includes('ads.google.com')) {
    return 'GOOGLE';
  }

  // X(TWITTER)
  if (lowerUrl.includes('twitter.com') || 
      lowerUrl.includes('x.com')) {
    return 'X(TWITTER)';
  }

  return 'UNKNOWN';
}

/**
 * 벤더별 특정 페이지 타입 감지 (예: FAQ, 도움말 등)
 * @param url 크롤링 대상 URL
 * @param vendor 벤더 타입
 * @returns 페이지 타입 (예: 'faq', 'help', 'notice' 등)
 */
export function detectPageType(url: string, vendor: VendorType): string | null {
  const lowerUrl = url.toLowerCase();

  switch (vendor) {
    case 'NAVER':
      if (lowerUrl.includes('/help/faq/')) return 'faq';
      if (lowerUrl.includes('/help/')) return 'help';
      if (lowerUrl.includes('/notice/')) return 'notice';
      break;
    
    case 'META':
      if (lowerUrl.includes('/help/')) return 'help';
      if (lowerUrl.includes('/business/help/')) return 'business-help';
      break;
    
    case 'GOOGLE':
      if (lowerUrl.includes('/support/')) return 'support';
      if (lowerUrl.includes('/help/')) return 'help';
      break;
    
    case 'KAKAO':
      if (lowerUrl.includes('/guide/')) return 'guide';
      if (lowerUrl.includes('/faq/')) return 'faq';
      break;
  }

  return null;
}

