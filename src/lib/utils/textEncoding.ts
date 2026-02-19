/**
 * 텍스트 인코딩 처리 유틸리티
 * 원본 데이터의 무결성을 보장하는 통합된 인코딩 처리
 */

export interface TextEncodingResult {
  originalText: string;
  cleanedText: string;
  encoding: string;
  hasIssues: boolean;
  issues: string[];
}

/**
 * 텍스트 인코딩을 감지하고 정리하는 통합 함수
 */
export function processTextEncoding(
  text: string,
  options: {
    preserveOriginal?: boolean;
    detectEncoding?: boolean;
    strictMode?: boolean;
  } = {}
): TextEncodingResult {
  const {
    preserveOriginal = true,
    detectEncoding = true,
    strictMode = false
  } = options;

  const issues: string[] = [];
  let cleanedText = text;
  let detectedEncoding = 'unknown';

  try {
    // 1. 원본 텍스트 보존
    const originalText = preserveOriginal ? text : '';

    // 2. null 문자 제거
    if (text.includes('\0')) {
      issues.push('null characters detected');
      cleanedText = cleanedText.replace(/\0/g, '');
    }

    // 3. 인코딩 감지 및 변환
    if (detectEncoding) {
      try {
        // UTF-8로 강제 변환 시도
        const utf8Text = Buffer.from(cleanedText, 'utf-8').toString('utf-8');
        
        // 변환 후 원본과 비교하여 인코딩 문제 감지
        if (utf8Text !== cleanedText) {
          issues.push('encoding conversion applied');
          cleanedText = utf8Text;
        }
        
        detectedEncoding = 'utf-8';
      } catch (error) {
        issues.push('utf-8 conversion failed');
        detectedEncoding = 'unknown';
      }
    }

    // 4. 제어 문자 정리 (strictMode에 따라 다르게 처리)
    if (strictMode) {
      // 엄격 모드: 한글과 기본 ASCII만 유지
      const beforeClean = cleanedText;
      cleanedText = cleanedText.replace(/[^\x20-\x7E\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g, '');
      if (beforeClean !== cleanedText) {
        issues.push('strict character filtering applied');
      }
    } else {
      // 일반 모드: 인쇄 가능한 문자만 유지
      const beforeClean = cleanedText;
      cleanedText = cleanedText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      if (beforeClean !== cleanedText) {
        issues.push('control characters removed');
      }
    }

    // 5. 공백 정리
    cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

    // 6. 최종 검증
    if (cleanedText.length === 0 && text.length > 0) {
      issues.push('text became empty after cleaning');
    }

    return {
      originalText,
      cleanedText,
      encoding: detectedEncoding,
      hasIssues: issues.length > 0,
      issues
    };

  } catch (error) {
    issues.push(`processing error: ${error instanceof Error ? error.message : 'unknown'}`);
    
    return {
      originalText: preserveOriginal ? text : '',
      cleanedText: text.replace(/\0/g, '').trim(),
      encoding: 'error',
      hasIssues: true,
      issues
    };
  }
}

/**
 * 파일에서 텍스트를 안전하게 추출하는 함수
 */
export async function extractTextFromFile(
  file: File,
  options: {
    encoding?: string;
    maxSize?: number;
  } = {}
): Promise<TextEncodingResult> {
  const { encoding = 'utf-8', maxSize = 10 * 1024 * 1024 } = options; // 10MB 기본 제한

  try {
    // 파일 크기 검증
    if (file.size > maxSize) {
      throw new Error(`File too large: ${file.size} bytes (max: ${maxSize})`);
    }

    // 파일 타입별 처리
    const fileExtension = file.name.toLowerCase().split('.').pop();
    
    switch (fileExtension) {
      case 'txt':
        // 텍스트 파일은 직접 읽기
        const textContent = await file.text();
        return processTextEncoding(textContent, { strictMode: true });
        
      case 'pdf':
        // PDF는 서버사이드에서 처리해야 함
        return {
          originalText: file.name,
          cleanedText: `[PDF 파일: ${file.name}] - 서버사이드 처리 필요`,
          encoding: 'pdf',
          hasIssues: true,
          issues: ['PDF requires server-side processing']
        };
        
      case 'docx':
        // DOCX도 서버사이드에서 처리해야 함
        return {
          originalText: file.name,
          cleanedText: `[DOCX 파일: ${file.name}] - 서버사이드 처리 필요`,
          encoding: 'docx',
          hasIssues: true,
          issues: ['DOCX requires server-side processing']
        };
        
      default:
        // 기타 파일은 바이너리로 처리
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const text = new TextDecoder(encoding).decode(uint8Array);
        return processTextEncoding(text, { strictMode: true });
    }
  } catch (error) {
    return {
      originalText: file.name,
      cleanedText: `[파일 처리 오류: ${file.name}]`,
      encoding: 'error',
      hasIssues: true,
      issues: [`file processing error: ${error instanceof Error ? error.message : 'unknown'}`]
    };
  }
}

/**
 * URL에서 텍스트를 안전하게 추출하는 함수
 */
export async function extractTextFromUrl(
  url: string,
  options: {
    timeout?: number;
    userAgent?: string;
  } = {}
): Promise<TextEncodingResult> {
  const { timeout = 30000, userAgent = 'Mozilla/5.0 (compatible; MetaFAQ-Bot/1.0)' } = options;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache'
      },
      signal: AbortSignal.timeout(timeout)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    
    if (!contentType.includes('text/')) {
      return {
        originalText: url,
        cleanedText: `[비텍스트 콘텐츠: ${url}]`,
        encoding: 'binary',
        hasIssues: true,
        issues: ['non-text content type']
      };
    }

    const text = await response.text();
    return processTextEncoding(text, { strictMode: true });

  } catch (error) {
    return {
      originalText: url,
      cleanedText: `[URL 처리 오류: ${url}]`,
      encoding: 'error',
      hasIssues: true,
      issues: [`URL processing error: ${error instanceof Error ? error.message : 'unknown'}`]
    };
  }
}

/**
 * 텍스트 품질 검증 함수
 */
export function validateTextQuality(result: TextEncodingResult): {
  score: number;
  recommendations: string[];
} {
  const recommendations: string[] = [];
  let score = 100;

  // 인코딩 문제 감점
  if (result.hasIssues) {
    score -= result.issues.length * 10;
  }

  // 텍스트 길이 검증
  if (result.cleanedText.length === 0) {
    score = 0;
    recommendations.push('텍스트가 비어있습니다');
  } else if (result.cleanedText.length < 10) {
    score -= 20;
    recommendations.push('텍스트가 너무 짧습니다');
  }

  // 한글 비율 검증
  const koreanChars = (result.cleanedText.match(/[\uAC00-\uD7AF]/g) || []).length;
  const totalChars = result.cleanedText.length;
  const koreanRatio = totalChars > 0 ? koreanChars / totalChars : 0;

  if (koreanRatio < 0.1 && totalChars > 50) {
    score -= 15;
    recommendations.push('한글 텍스트가 부족합니다');
  }

  // 특수 문자 비율 검증
  const specialChars = (result.cleanedText.match(/[^\x20-\x7E\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g) || []).length;
  const specialRatio = totalChars > 0 ? specialChars / totalChars : 0;

  if (specialRatio > 0.1) {
    score -= 10;
    recommendations.push('특수 문자가 많습니다');
  }

  return {
    score: Math.max(0, score),
    recommendations
  };
}
