/**
 * Puppeteer 기반 크롤링 API
 * Facebook/Instagram 등 JavaScript가 필요한 사이트 크롤링
 * 동적 크롤링만 사용 (필수)
 */

import { NextRequest, NextResponse } from 'next/server';
import { puppeteerCrawlingService } from '@/lib/services/PuppeteerCrawlingService';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5분

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
      // 사용자 정의 URL 크롤링 - 동적 크롤링만 사용 (필수)
      console.log(`🌐 사용자 정의 URL 크롤링 시작: ${urls.length}개`);
      
      const { extractSubPages = false, maxDepth = 2 } = body; // 하위 페이지 추출 옵션 및 최대 심도
      const maxDepthValue = Math.max(1, Math.min(4, parseInt(String(maxDepth), 10) || 2));
      console.log(`🔍 하위 페이지 추출: ${extractSubPages ? '활성화' : '비활성화'}, 최대 심도: ${maxDepthValue}`);
      
      const documents = [];
      const processedUrls = [];
      
      for (const url of urls) {
        try {
          // 동적 크롤링만 시도 (필수)
          console.log(`🚀 동적 크롤링 시도: ${url}`);
          const document = await puppeteerCrawlingService.crawlMetaPage(url, extractSubPages, true, maxDepthValue);
          
          if (document) {
            documents.push(document);
            
            // 발견된 하위 페이지들도 크롤링 (심도 2까지만 자동 크롤링, 심도 3 이상은 모달에서 선택)
            if (document.discoveredUrls && document.discoveredUrls.length > 0) {
              const depth2Urls = document.discoveredUrls.filter((sub: any) => sub.depth <= 2);
              const depth3PlusUrls = document.discoveredUrls.filter((sub: any) => sub.depth >= 3);
              
              console.log(`🔍 하위 페이지 크롤링 시작: ${depth2Urls.length}개 (심도 2 이하), ${depth3PlusUrls.length}개 (심도 3 이상 - 모달에서 선택)`);
              
              // 심도 2 이하만 자동 크롤링
              for (const subPageInfo of depth2Urls) {
                try {
                  const subDocument = await puppeteerCrawlingService.crawlMetaPage(subPageInfo.url, false, true, 1);
                  if (subDocument) {
                    documents.push(subDocument);
                    console.log(`✅ 하위 페이지 크롤링 완료: ${subDocument.title}`);
                  }
                } catch (subError) {
                  console.error(`❌ 하위 페이지 크롤링 실패: ${subPageInfo.url}`, subError);
                  // 실패해도 계속 진행
                }
              }
              
              // 심도 3 이상은 discoveredUrls에 포함하여 모달에서 선택하도록 함
              if (depth3PlusUrls.length > 0) {
                document.discoveredUrls = depth3PlusUrls;
              } else {
                document.discoveredUrls = undefined;
              }
            }
            
            processedUrls.push({ 
              url, 
              title: document.title, 
              status: 'success'
            });
            console.log(`✅ 동적 크롤링 성공: ${document.title}`);
          } else {
            processedUrls.push({ url, status: 'failed', error: '동적 크롤링 실패' });
            console.log(`❌ 실패: ${url}`);
          }
        } catch (error) {
          processedUrls.push({ url, status: 'error', error: error instanceof Error ? error.message : String(error) });
          console.error(`URL 크롤링 오류: ${url}`, error);
        }
      }
      
      console.log(`📋 사용자 정의 URL 크롤링 완료: ${documents.length}개`);
      
      return NextResponse.json({
        success: true,
        message: `${documents.length}개 문서 크롤링 완료`,
        documents: documents,
        processedUrls: processedUrls,
        totalCount: urls.length,
        successCount: documents.length,
        failCount: urls.length - documents.length
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
