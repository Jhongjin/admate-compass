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

        // 3. 여전히 콘텐츠가 없는 경우, 더 공격적인 텍스트 추출 시도
        if (!textContent || textContent.trim().length === 0) {
          console.warn(`⚠️ 일반적인 방법으로 텍스트를 추출하지 못했습니다. 대체 방법을 시도합니다.`);
          
          // 모든 텍스트 노드를 직접 추출
          const allTextNodes: string[] = [];
          $('*').each((_, el) => {
            const $el = $(el);
            // script, style 제외
            const tagName = (el as any).tagName || (el as any).name || '';
            if (tagName === 'script' || tagName === 'style') return;
            
            const text = $el.text().trim();
            if (text && text.length > 10) { // 최소 10자 이상만
              allTextNodes.push(text);
            }
          });
          
          if (allTextNodes.length > 0) {
            // 중복 제거 및 정렬 (긴 텍스트 우선)
            const uniqueTexts = Array.from(new Set(allTextNodes))
              .sort((a, b) => b.length - a.length)
              .slice(0, 20); // 상위 20개만 선택
            
            textContent = uniqueTexts.join('\n\n');
            console.log(`✅ 대체 방법으로 텍스트 추출 성공: ${textContent.length}자`);
          }
          
          // 여전히 없으면 메타데이터에서 추출
          if (!textContent || textContent.trim().length === 0) {
            const metaDescription = $('meta[name="description"]').attr('content') || 
                                   $('meta[property="og:description"]').attr('content') ||
                                   $('meta[name="keywords"]').attr('content');
            
            if (metaDescription) {
              textContent = metaDescription;
              console.log(`✅ 메타데이터에서 텍스트 추출: ${textContent.length}자`);
            }
          }
        }

        // 4. 콘텐츠가 짧은 경우 Puppeteer로 재시도 (Vercel 서버리스에서는 실패할 수 있음)
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
            // Puppeteer 실패는 무시하고 기존 텍스트 사용 (있는 경우)
            if (textContent && textContent.length > 0) {
              console.warn(`⚠️ Puppeteer 실패했지만 기존 텍스트 사용: ${textContent.length}자`);
            }
          }
        }

        // 5. 최종 검증: 최소한의 텍스트라도 있어야 함
        if (!textContent || textContent.trim().length === 0) {
          // 최소한 제목이라도 사용
          textContent = pageTitle || document.title || document.url;
          console.warn(`⚠️ 크롤링된 콘텐츠가 비어있어 제목을 사용합니다: ${textContent}`);
          
          // 제목만으로는 RAG 처리가 의미 없으므로, 실패로 처리 (main_document_id 유지)
          await supabase
            .from('documents')
            .update({
              content: textContent,
              title: pageTitle,
              main_document_id: document.main_document_id, // 그룹 관계 유지
              status: 'failed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', documentId);
          
          return NextResponse.json(
            {
              success: false,
              error: '크롤링된 콘텐츠가 비어있습니다. 페이지가 JavaScript로만 렌더링되거나 접근이 제한되었을 수 있습니다.',
              requiresCrawl: true,
              url: document.url,
            },
            { status: 400 }
          );
        }

        content = textContent;
        
        // 크롤링한 콘텐츠를 DB에 저장 (main_document_id 유지)
        await supabase
          .from('documents')
          .update({
            content: content,
            title: pageTitle,
            main_document_id: document.main_document_id, // 그룹 관계 유지
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
    console.log(`[CRITICAL] 📌 재처리 전 main_document_id: ${document.main_document_id || 'null'}`);

    // 문서 상태를 processing으로 변경 (main_document_id 유지)
    await supabase
      .from('documents')
      .update({
        status: 'processing',
        main_document_id: document.main_document_id || null, // 그룹 관계 유지
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    // RAG 처리
    // main_document_id는 null일 수도 있으므로 ?? 연산자 사용 (undefined일 때만 null로 변환)
    const mainDocumentId = document.main_document_id ?? null;
    console.log(`[CRITICAL] 📌 RAG 처리 전달 main_document_id: ${mainDocumentId || 'null'} (원본: ${document.main_document_id})`);
    const ragProcessor = new RAGProcessor();
    const ragResult = await ragProcessor.processDocument({
      id: document.id,
      title: pageTitle, // 크롤링한 제목 사용
      content: content, // 크롤링한 콘텐츠 사용
      type: 'url',
      file_size: Buffer.byteLength(content, 'utf8'),
      file_type: 'text/html',
      source_vendor: document.source_vendor || 'META',
      main_document_id: mainDocumentId, // 그룹 관계 유지 (null도 유효한 값)
      created_at: (document as any).created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (ragResult.success) {
      // RAG 처리 후 현재 문서의 main_document_id 확인
      const { data: currentDoc } = await supabase
        .from('documents')
        .select('main_document_id')
        .eq('id', documentId)
        .maybeSingle();
      
      // main_document_id 우선순위: 1) 원본 문서 값, 2) 현재 DB 값
      const finalMainDocumentId = document.main_document_id ?? currentDoc?.main_document_id ?? null;
      
      console.log(`[CRITICAL] 📌 최종 업데이트 전 main_document_id 확인:`, {
        원본문서: document.main_document_id || 'null',
        현재DB: currentDoc?.main_document_id || 'null',
        최종값: finalMainDocumentId || 'null'
      });
      
      // 성공 시 문서 상태 업데이트 (main_document_id 유지)
      const { error: finalUpdateError } = await supabase
        .from('documents')
        .update({
          status: 'indexed',
          chunk_count: ragResult.chunkCount,
          main_document_id: finalMainDocumentId, // 그룹 관계 유지
          updated_at: new Date().toISOString(),
        })
        .eq('id', documentId);

      if (finalUpdateError) {
        console.error(`[CRITICAL] ❌ 최종 업데이트 실패:`, finalUpdateError);
      } else {
        console.log(`[CRITICAL] ✅ 최종 업데이트 완료: main_document_id=${finalMainDocumentId || 'null'}`);
      }

      console.log(`✅ URL 문서 재처리 완료: ${document.title} (청크: ${ragResult.chunkCount}개)`);

      return NextResponse.json({
        success: true,
        message: 'URL 문서 재처리 완료',
        documentId: document.id,
        chunkCount: ragResult.chunkCount,
      });
    } else {
      // 실패 시 문서 상태 업데이트 (main_document_id 유지)
      // 현재 문서의 main_document_id 확인
      const { data: currentDoc } = await supabase
        .from('documents')
        .select('main_document_id')
        .eq('id', documentId)
        .maybeSingle();
      
      const finalMainDocumentId = document.main_document_id ?? currentDoc?.main_document_id ?? null;
      
      await supabase
        .from('documents')
        .update({
          status: 'failed',
          main_document_id: finalMainDocumentId, // 그룹 관계 유지
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

