/**
 * Puppeteer 기반 크롤링 API
 * Facebook/Instagram 등 JavaScript가 필요한 사이트 크롤링
 * 동적 크롤링 우선, 실패 시 Cheerio fallback
 */

import { NextRequest, NextResponse } from 'next/server';
import { puppeteerCrawlingService } from '@/lib/services/PuppeteerCrawlingService';
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5분

/**
 * Cheerio를 사용한 정적 HTML 크롤링 (fallback)
 */
async function crawlWithCheerio(url: string): Promise<{ title: string; content: string; isStatic: boolean } | null> {
  try {
    console.log(`📄 Cheerio 정적 크롤링 시도: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const htmlContent = await response.text();
    const $ = cheerio.load(htmlContent);

    // 제목 추출
    let title = $('h1').first().text().trim() || 
               $('title').text().trim() || 
               $('meta[property="og:title"]').attr('content')?.trim() ||
               url;

    // 콘텐츠 추출
    const contentSelectors = ['main', 'article', '[role="main"]', '.content', '.main-content', '.page-content', '#content', '#main-content'];
    let textContent = '';
    
    for (const selector of contentSelectors) {
      const $content = $(selector).first();
      if ($content.length > 0) {
        $content.find('script, style, nav, footer, header, aside').remove();
        const extracted = $content.text().replace(/\s+/g, ' ').trim();
        if (extracted.length > textContent.length) {
          textContent = extracted;
        }
        if (textContent.length > 1000) break;
      }
    }

    if (!textContent || textContent.length < 100) {
      const $body = $('body');
      $body.find('script, style, nav, footer, header, aside').remove();
      textContent = $body.text().replace(/\s+/g, ' ').trim();
    }

    if (!textContent || textContent.length < 50) {
      return null;
    }

    console.log(`✅ Cheerio 크롤링 성공: ${textContent.length}자`);
    return { title, content: textContent, isStatic: true };
  } catch (error) {
    console.error(`❌ Cheerio 크롤링 실패: ${url}`, error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('🕷️ Puppeteer 크롤링 API 시작');

    const body = await request.json();
    const { urls, action } = body;

    if (action === 'crawl_meta') {
      // Meta 공식 사이트 크롤링
      console.log('🌐 Meta 공식 사이트 크롤링 시작');
      
      const documents = await puppeteerCrawlingService.crawlAllMetaDocuments();
      
      return NextResponse.json({
        success: true,
        message: `${documents.length}개 Meta 문서 크롤링 완료`,
        documents: documents,
        totalCount: documents.length,
        successCount: documents.length,
        failCount: 0
      });

    } else if (action === 'crawl_custom' && urls && Array.isArray(urls)) {
      // 사용자 정의 URL 크롤링 - 동적 크롤링 우선, 실패 시 정적 크롤링
      console.log(`🌐 사용자 정의 URL 크롤링 시작: ${urls.length}개`);
      
      const { extractSubPages = false } = body; // 하위 페이지 추출 옵션
      console.log(`🔍 하위 페이지 추출: ${extractSubPages ? '활성화' : '비활성화'}`);
      
      const documents = [];
      const processedUrls = [];
      const staticCrawlWarnings: string[] = []; // 정적 크롤링만 성공한 URL 목록
      
      for (const url of urls) {
        try {
          // 1단계: 동적 크롤링 시도 (Puppeteer 우선)
          console.log(`🚀 동적 크롤링 시도: ${url}`);
          let document = await puppeteerCrawlingService.crawlMetaPage(url, extractSubPages, true);
          let isDynamic = true;
          
          // 2단계: 동적 크롤링 실패 시 정적 크롤링 시도 (Cheerio fallback)
          if (!document) {
            console.warn(`⚠️ 동적 크롤링 실패, 정적 크롤링 시도: ${url}`);
            const staticResult = await crawlWithCheerio(url);
            
            if (staticResult) {
              // 정적 크롤링 결과를 동적 크롤링 형식으로 변환
              document = {
                id: `crawled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                title: staticResult.title,
                content: staticResult.content,
                url: url,
                type: 'general' as const,
                lastUpdated: new Date().toISOString(),
                contentLength: staticResult.content.length,
              };
              isDynamic = false;
              staticCrawlWarnings.push(url);
              console.warn(`⚠️ 정적 크롤링만 성공: ${url} (동적 콘텐츠 누락 가능)`);
            }
          }
          
          if (document) {
            // 동적/정적 여부를 문서에 표시
            (document as any).isDynamic = isDynamic;
            documents.push(document);
            
            // 발견된 하위 페이지들도 크롤링 (동적 크롤링 성공 시에만)
            if (isDynamic && document.discoveredUrls && document.discoveredUrls.length > 0) {
              console.log(`🔍 하위 페이지 크롤링 시작: ${document.discoveredUrls.length}개`);
              
              for (const subPageInfo of document.discoveredUrls) {
                try {
                  const subDocument = await puppeteerCrawlingService.crawlMetaPage(subPageInfo.url, false, true);
                  if (subDocument) {
                    (subDocument as any).isDynamic = true;
                    documents.push(subDocument);
                    console.log(`✅ 하위 페이지 크롤링 완료: ${subDocument.title}`);
                  }
                } catch (subError) {
                  console.error(`❌ 하위 페이지 크롤링 실패: ${subPageInfo.url}`, subError);
                }
              }
            }
            
            processedUrls.push({ 
              url, 
              title: document.title, 
              status: 'success',
              isDynamic: isDynamic,
              warning: isDynamic ? undefined : '정적 크롤링만 성공 (동적 콘텐츠 누락 가능)'
            });
            console.log(`✅ ${isDynamic ? '동적' : '정적'} 크롤링 성공: ${document.title}`);
          } else {
            processedUrls.push({ url, status: 'failed', error: '동적 및 정적 크롤링 모두 실패' });
            console.log(`❌ 실패: ${url}`);
          }
        } catch (error) {
          processedUrls.push({ url, status: 'error', error: error instanceof Error ? error.message : String(error) });
          console.error(`URL 크롤링 오류: ${url}`, error);
        }
      }
      
      console.log(`📋 사용자 정의 URL 크롤링 완료: ${documents.length}개`);
      
      // 정적 크롤링만 성공한 경우가 있으면 경고 메시지 추가
      let message = `${documents.length}개 문서 크롤링 완료`;
      if (staticCrawlWarnings.length > 0) {
        message += ` (주의: ${staticCrawlWarnings.length}개 URL은 정적 크롤링만 성공 - 동적 콘텐츠 누락 가능)`;
      }
      
      return NextResponse.json({
        success: true,
        message: message,
        documents: documents,
        processedUrls: processedUrls,
        totalCount: urls.length,
        successCount: documents.length,
        failCount: urls.length - documents.length,
        warnings: staticCrawlWarnings.length > 0 ? {
          staticCrawlOnly: staticCrawlWarnings,
          message: `${staticCrawlWarnings.length}개 URL이 정적 크롤링만 성공했습니다. JavaScript로 렌더링되는 콘텐츠는 누락되었을 수 있습니다.`
        } : undefined
      });
      
    } else {
      return NextResponse.json({ error: '지원하지 않는 액션입니다' }, { status: 400 });
    }
    
  } catch (error) {
    console.error('❌ Puppeteer 크롤링 API 오류:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '알 수 없는 오류',
      message: 'Puppeteer 크롤링 중 오류가 발생했습니다.'
    }, { status: 500 });
  } finally {
    // Puppeteer 브라우저 종료
    await puppeteerCrawlingService.close();
  }
}
