/**
 * 실패한 URL 문서 재처리 API
 * 
 * 크롤링 중 실패한 하위 페이지 문서를 재처리합니다.
 * URL 문서는 PDF_PARSE/DOCX_PARSE가 아닌 RAG 처리를 다시 수행합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';
import { RAGProcessor } from '@/lib/services/RAGProcessor';
import { PuppeteerCrawlingService } from '@/lib/services/PuppeteerCrawlingService';
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5분
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { documentId } = body;

    if (!documentId) {
      return NextResponse.json(
        { success: false, error: 'documentId는 필수입니다.' },
        { status: 400 }
      );
    }

    const supabase = await createPureClient();

    // 문서 정보 조회
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, title, content, url, type, source_vendor, main_document_id, status, created_at')
      .eq('id', documentId)
      .maybeSingle();

    if (docError) {
      console.error('❌ 문서 조회 실패:', docError);
      return NextResponse.json(
        { success: false, error: '문서를 찾을 수 없습니다.', details: docError.message },
        { status: 404 }
      );
    }

    if (!document) {
      return NextResponse.json(
        { success: false, error: '문서를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // URL 문서인지 확인
    if (document.type !== 'url' || !document.url) {
      return NextResponse.json(
        {
          success: false,
          error: `이 문서는 URL 크롤링 문서가 아닙니다 (type: ${document.type}). URL 문서만 재처리할 수 있습니다.`,
          documentType: document.type,
        },
        { status: 400 }
      );
    }

    // 콘텐츠가 없는 경우 URL에서 다시 크롤링
    let content = document.content;
    let pageTitle = document.title;
    
    if (!content || content.trim().length === 0) {
      console.log(`🔄 문서 콘텐츠가 비어있어 URL에서 다시 크롤링합니다: ${document.url}`);
      
      try {
        const commonHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
        } as Record<string, string>;

        // URL에서 페이지 다운로드
        const response = await fetch(document.url, {
          headers: commonHeaders,
          signal: AbortSignal.timeout(30000),
          redirect: 'follow',
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const htmlContent = await response.text();
        const $ = cheerio.load(htmlContent);

        // 제목 추출 (우선순위: h1 > title > og:title > pathname)
        pageTitle = $('h1').first().text().trim() || 
                   $('title').text().trim() || 
                   $('meta[property="og:title"]').attr('content')?.trim() ||
                   htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ||
                   document.title;
        
        if (!pageTitle || pageTitle.length < 2) {
          const urlPath = new URL(document.url).pathname;
          pageTitle = urlPath && urlPath !== '/' ? urlPath.split('/').pop() || urlPath : document.url;
        }

        // 개선된 텍스트 추출: 구조를 유지하면서 텍스트 추출
        let textContent = '';
        
        // 텍스트 추출 헬퍼 함수
        const extractTextWithStructure = ($element: cheerio.Cheerio): string => {
          const $clone = $element.clone();
          $clone.find('script, style, nav, footer, header, aside').remove();
          
          // 링크는 텍스트만 표시
          $clone.find('a').each((_, el) => {
            const $el = $(el);
            const text = $el.text().trim();
            if (text) {
              $el.replaceWith(` ${text} `);
            } else {
              $el.replaceWith(' ');
            }
          });
          
          // 블록 요소를 줄바꿈으로 변환
          const blockElements = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'li', 'td', 'th', 'tr', 'section', 'article', 'main'];
          blockElements.forEach(tag => {
            $clone.find(tag).each((_, el) => {
              const $el = $(el);
              const text = $el.text().trim();
              if (text) {
                $el.replaceWith(`\n${text}\n`);
              } else {
                $el.replaceWith('\n');
              }
            });
          });
          
          $clone.find('br').each((_, el) => {
            $(el).replaceWith('\n');
          });
          
          // 인라인 요소는 공백으로 변환
          $clone.find('span, strong, em, b, i, code').each((_, el) => {
            const $el = $(el);
            const text = $el.text().trim();
            if (text) {
              $el.replaceWith(` ${text} `);
            }
          });
          
          const html = $clone.html() || '';
          let text = html
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'");
          
          text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
          return text;
        };
        
        // 1. 주요 콘텐츠 영역 우선 추출
        const contentSelectors = [
          'main',
          'article',
          '[role="main"]',
          '.content',
          '.main-content',
          '.page-content',
          '#content',
          '#main-content'
        ];
        
        let foundContent = false;
        for (const selector of contentSelectors) {
          const $content = $(selector).first();
          if ($content.length > 0) {
            const extracted = extractTextWithStructure($content.clone());
            if (extracted.length > textContent.length) {
              textContent = extracted;
              foundContent = true;
            }
            if (textContent.length > 1000) break;
          }
        }
        
        // 2. 주요 콘텐츠 영역을 찾지 못했거나 너무 짧은 경우 body 전체에서 추출
        if (!foundContent || textContent.length < 500) {
          const $body = $('body');
          if ($body.length > 0) {
            const fullText = extractTextWithStructure($body.clone());
            if (fullText.length > textContent.length) {
              textContent = fullText;
            }
          }
        }

        // 3. 콘텐츠가 짧은 경우 Puppeteer로 재시도
        if (!textContent || textContent.length < 100) {
          console.warn(`⚠️ Cheerio로 추출한 콘텐츠가 짧습니다 (${textContent.length}자). Puppeteer로 재시도합니다.`);
          
          try {
            const puppeteerService = new PuppeteerCrawlingService();
            const puppeteerResult = await puppeteerService.crawlMetaPage(document.url, false, true);
            
            if (puppeteerResult && puppeteerResult.content && puppeteerResult.content.length >= 100) {
              console.log(`✅ Puppeteer로 콘텐츠 추출 성공: ${puppeteerResult.content.length}자`);
              textContent = puppeteerResult.content;
              if (puppeteerResult.title) {
                pageTitle = puppeteerResult.title;
              }
            } else {
              console.warn(`⚠️ Puppeteer로도 충분한 콘텐츠를 추출하지 못했습니다 (${puppeteerResult?.content?.length || 0}자)`);
              if (textContent && textContent.length > 0) {
                console.warn(`⚠️ Puppeteer 실패했지만 Cheerio 결과 사용: ${textContent.length}자`);
              }
            }
            
            await puppeteerService.close().catch(() => {});
          } catch (puppeteerError) {
            console.error(`❌ Puppeteer 재시도 실패:`, puppeteerError);
            if (textContent && textContent.length > 0) {
              console.warn(`⚠️ Puppeteer 실패했지만 Cheerio 결과 사용: ${textContent.length}자`);
            }
          }
        }

        if (!textContent || textContent.trim().length === 0) {
          throw new Error('크롤링된 콘텐츠가 비어있습니다. 페이지가 JavaScript로만 렌더링되거나 접근이 제한되었을 수 있습니다.');
        }

        content = textContent;
        
        // 크롤링한 콘텐츠를 DB에 저장
        await supabase
          .from('documents')
          .update({
            content: content,
            title: pageTitle,
            updated_at: new Date().toISOString(),
          })
          .eq('id', documentId);

        console.log(`✅ URL 크롤링 완료: ${content.length}자`);
      } catch (crawlError) {
        console.error('❌ URL 크롤링 실패:', crawlError);
        return NextResponse.json(
          {
            success: false,
            error: `URL 크롤링 실패: ${crawlError instanceof Error ? crawlError.message : String(crawlError)}`,
            requiresCrawl: true,
            url: document.url,
          },
          { status: 400 }
        );
      }
    }

    console.log(`🔄 URL 문서 재처리 시작: ${document.title} (${document.url})`);

    // 문서 상태를 processing으로 변경
    await supabase
      .from('documents')
      .update({
        status: 'processing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    // RAG 처리
    const ragProcessor = new RAGProcessor();
    const ragResult = await ragProcessor.processDocument({
      id: document.id,
      title: pageTitle, // 크롤링한 제목 사용
      content: content, // 크롤링한 콘텐츠 사용
      type: 'url',
      file_size: Buffer.byteLength(content, 'utf8'),
      file_type: 'text/html',
      source_vendor: document.source_vendor || 'META',
      created_at: (document as any).created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (ragResult.success) {
      // 성공 시 문서 상태 업데이트
      await supabase
        .from('documents')
        .update({
          status: 'indexed',
          chunk_count: ragResult.chunkCount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', documentId);

      console.log(`✅ URL 문서 재처리 완료: ${document.title} (청크: ${ragResult.chunkCount}개)`);

      return NextResponse.json({
        success: true,
        message: 'URL 문서 재처리 완료',
        documentId: document.id,
        chunkCount: ragResult.chunkCount,
      });
    } else {
      // 실패 시 문서 상태 업데이트
      await supabase
        .from('documents')
        .update({
          status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', documentId);

      const errorMessage = ragResult.error || 'RAG 처리 실패';
      console.error(`❌ URL 문서 재처리 실패: ${document.title}`, errorMessage);

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          documentId: document.id,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('❌ URL 문서 재처리 API 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '재처리 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

