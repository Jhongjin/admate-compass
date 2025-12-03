/**
 * URL 유틸리티 함수
 */

/**
 * 도메인 추출
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * 기본 URL 추출 (프로토콜 + 호스트)
 */
export function getBaseUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}`;
  } catch {
    return '';
  }
}

/**
 * URL 정규화 (프래그먼트 제거, 슬래시 정리 등)
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // 프래그먼트 제거
    urlObj.hash = '';
    // 쿼리 파라미터 정렬 (선택사항)
    // urlObj.searchParams.sort();
    // 마지막 슬래시 제거 (경로가 있는 경우)
    if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    return urlObj.toString();
  } catch {
    return url;
  }
}

/**
 * 상대 URL을 절대 URL로 변환
 */
export function resolveUrl(baseUrl: string, relativeUrl: string): string {
  try {
    return new URL(relativeUrl, baseUrl).toString();
  } catch {
    return relativeUrl;
  }
}

/**
 * URL이 같은 도메인인지 확인
 */
export function isSameDomain(url1: string, url2: string): boolean {
  try {
    const domain1 = extractDomain(url1);
    const domain2 = extractDomain(url2);
    return domain1 === domain2 || domain1.endsWith(`.${domain2}`) || domain2.endsWith(`.${domain1}`);
  } catch {
    return false;
  }
}

/**
 * URL이 허용된 도메인 목록에 포함되는지 확인
 */
export function isAllowedDomain(url: string, allowedDomains?: string[]): boolean {
  if (!allowedDomains || allowedDomains.length === 0) {
    return true;
  }
  
  const urlDomain = extractDomain(url);
  return allowedDomains.some(domain => 
    urlDomain === domain || 
    urlDomain.endsWith(`.${domain}`) ||
    domain.endsWith(`.${urlDomain}`)
  );
}

/**
 * URL 유효성 검사
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * URL 깊이 계산 (시드 URL 기준)
 */
export function calculateDepth(seedUrl: string, currentUrl: string): number {
  try {
    const seedObj = new URL(seedUrl);
    const currentObj = new URL(currentUrl);
    
    // 같은 도메인이 아니면 깊이 999 (무한대 대신 큰 수 사용)
    if (seedObj.hostname !== currentObj.hostname) {
      return 999;
    }
    
    const seedPath = seedObj.pathname.split('/').filter(p => p);
    const currentPath = currentObj.pathname.split('/').filter(p => p);
    
    // 공통 경로 찾기
    let commonLength = 0;
    for (let i = 0; i < Math.min(seedPath.length, currentPath.length); i++) {
      if (seedPath[i] === currentPath[i]) {
        commonLength++;
      } else {
        break;
      }
    }
    
    // 깊이는 현재 경로 길이 - 공통 경로 길이
    return Math.max(1, currentPath.length - commonLength + 1);
  } catch {
    return 1;
  }
}

/**
 * URL 경로 생성 (시드부터 현재까지)
 */
export function buildUrlPath(seedUrl: string, currentUrl: string, parentPath?: string[]): string[] {
  if (parentPath) {
    return [...parentPath, currentUrl];
  }
  return [seedUrl, currentUrl];
}

/**
 * 도메인이 다른 도메인의 하위 도메인인지 확인
 * @param subDomain 확인할 도메인 (예: sub.example.com)
 * @param baseDomain 기준 도메인 (예: example.com)
 * @returns 하위 도메인이면 true
 */
export function isSubdomain(subDomain: string, baseDomain: string): boolean {
  if (subDomain === baseDomain) {
    return false; // 같은 도메인은 하위 도메인이 아님
  }
  
  // 하위 도메인 체크: sub.example.com은 example.com의 하위 도메인
  return subDomain.endsWith(`.${baseDomain}`);
}

/**
 * 도메인이 같은 루트 도메인인지 확인 (같은 도메인 또는 하위 도메인)
 * @param domain1 첫 번째 도메인
 * @param domain2 두 번째 도메인
 * @returns 같은 루트 도메인이면 true
 */
export function isSameRootDomain(domain1: string, domain2: string): boolean {
  if (domain1 === domain2) {
    return true;
  }
  
  // domain1이 domain2의 하위 도메인인지 확인
  if (isSubdomain(domain1, domain2)) {
    return true;
  }
  
  // domain2가 domain1의 하위 도메인인지 확인
  if (isSubdomain(domain2, domain1)) {
    return true;
  }
  
  return false;
}

