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
    const { documentId, url: overrideUrl, type: overrideType } = body;

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
      .select('id, title, content, url, document_url, type, source_vendor, main_document_id, status, created_at')
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

    // URL 정보 및 타입 보정
    let effectiveUrl = document.url || document.document_url || overrideUrl || null;
    const effectiveType = document.type || overrideType || (document.url || document.document_url ? 'url' : null);

    if (!effectiveUrl) {
      const { data: metadataRow, error: metadataError } = await supabase
        .from('document_metadata')
        .select('metadata')
        .eq('id', documentId)
        .maybeSingle();

      if (metadataError) {
        console.error('⚠️ document_metadata 조회 실패:', metadataError);
      }

      if (metadataRow?.metadata) {
        const metadata = metadataRow.metadata as Record<string, any>;
        const metadataCandidates = [
          metadata.source_url,
          metadata.original_url,
          metadata.document_url,
          metadata.url,
        ];
        const foundUrl = metadataCandidates.find(
          (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
        );
        if (foundUrl) {
          effectiveUrl = foundUrl;
        }
      }
    }

    if (!effectiveUrl) {
      const { data: jobRow, error: jobError } = await supabase
        .from('processing_jobs')
        .select('payload, result')
        .eq('document_id', documentId)
        .eq('job_type', 'CRAWL_SEED')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (jobError) {
        console.error('⚠️ processing_jobs 조회 실패:', jobError);
      }

      if (jobRow) {
        const parsePayload = (raw: any) => {
          if (!raw) return undefined;
          if (typeof raw === 'string') {
            try {
              return JSON.parse(raw);
            } catch {
              return undefined;
            }
          }
          return raw;
        };

        const payload = parsePayload(jobRow.payload);
        const result = parsePayload(jobRow.result);

        const jobCandidates = [
          payload?.url,
          result?.url,
          result?.mainUrl,
          result?.documentUrl,
          result?.resolvedUrl,
          result?.sourceUrl,
        ];

        const foundUrl = jobCandidates.find(
          (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
        );

        if (foundUrl) {
          effectiveUrl = foundUrl;
        }
      }
    }

    if (!effectiveUrl) {
      return NextResponse.json(
        {
          success: false,
          error: '문서에 URL 정보가 없습니다. 메타데이터에도 URL이 없어 재처리할 수 없습니다.',
        },
        { status: 400 }
      );
    }

    // URL 문서인지 확인
    if (effectiveType !== 'url') {
      return NextResponse.json(
        {
          success: false,
          error: `이 문서는 URL 크롤링 문서가 아닙니다 (type: ${effectiveType || document.type}). URL 문서만 재처리할 수 있습니다.`,
          documentType: effectiveType || document.type,
        },
        { status: 400 }
      );
    }

    if (!effectiveUrl) {
      return NextResponse.json(
        {
          success: false,
          error: '문서 URL이 비어있습니다. URL 문서만 재처리할 수 있습니다.',
          documentType: effectiveType || document.type,
        },
        { status: 400 }
      );
    }

    document.url = effectiveUrl;
    if (effectiveType && document.type !== effectiveType) {
      document.type = effectiveType;
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
            try {
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
            } finally {
              await puppeteerService.close().catch(() => { });
            }
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

    // 재처리 전 DB에서 현재 main_document_id 확인 (재처리 중 다른 프로세스가 변경했을 수 있음)
    const { data: currentDocBeforeProcessing } = await supabase
      .from('documents')
      .select('main_document_id')
      .eq('id', documentId)
      .maybeSingle();

    // main_document_id 우선순위: 1) 원본 문서 값, 2) 현재 DB 값
    const mainDocumentIdToPreserve = document.main_document_id ?? currentDocBeforeProcessing?.main_document_id ?? null;

    // 재처리되는 문서 추적 로그 (그룹화 로직에서 사용)
    console.log(`[REPROCESS] 🔄 문서 재처리 시작:`, {
      documentId: document.id,
      documentTitle: document.title?.substring(0, 50),
      documentUrl: document.url,
      mainDocumentId: mainDocumentIdToPreserve || 'null',
      hasMainDocumentId: mainDocumentIdToPreserve !== null && mainDocumentIdToPreserve !== undefined,
      원본문서값: document.main_document_id || 'null',
      현재DB값: currentDocBeforeProcessing?.main_document_id || 'null',
      보존값: mainDocumentIdToPreserve || 'null',
      timestamp: new Date().toISOString(),
    });

    console.log(`[CRITICAL] 📌 main_document_id 보존 값 결정:`, {
      원본문서값: document.main_document_id || 'null',
      현재DB값: currentDocBeforeProcessing?.main_document_id || 'null',
      최종보존값: mainDocumentIdToPreserve || 'null'
    });

    // 문서 상태를 processing으로 변경 (main_document_id 명시적으로 유지)
    await supabase
      .from('documents')
      .update({
        status: 'processing',
        main_document_id: mainDocumentIdToPreserve, // 그룹 관계 명시적으로 유지
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    // RAG 처리
    // 보존된 main_document_id를 RAG 처리에 전달
    console.log(`[CRITICAL] 📌 RAG 처리 전달 main_document_id: ${mainDocumentIdToPreserve || 'null'} (원본: ${document.main_document_id || 'null'})`);
    const ragProcessor = new RAGProcessor();
    const ragResult = await ragProcessor.processDocument({
      id: document.id,
      title: pageTitle, // 크롤링한 제목 사용
      content: content, // 크롤링한 콘텐츠 사용
      type: 'url',
      file_size: Buffer.byteLength(content, 'utf8'),
      file_type: 'text/html',
      url: effectiveUrl,
      source_vendor: document.source_vendor || 'META',
      main_document_id: mainDocumentIdToPreserve, // 보존된 그룹 관계 전달 (null도 유효한 값)
      created_at: (document as any).created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (ragResult.success) {
      // RAG 처리 후 현재 문서의 main_document_id 확인 (RAG 처리 중 변경되었을 수 있음)
      const { data: currentDoc } = await supabase
        .from('documents')
        .select('main_document_id')
        .eq('id', documentId)
        .maybeSingle();

      // main_document_id 우선순위: 1) 보존된 값, 2) 현재 DB 값 (RAG 처리 중 변경되었을 수 있음)
      // 보존된 값이 있으면 항상 우선 사용 (재처리 시 그룹 관계 유지)
      const finalMainDocumentId = mainDocumentIdToPreserve ?? currentDoc?.main_document_id ?? null;

      console.log(`[CRITICAL] 📌 최종 업데이트 전 main_document_id 확인:`, {
        보존된값: mainDocumentIdToPreserve || 'null',
        원본문서: document.main_document_id || 'null',
        현재DB: currentDoc?.main_document_id || 'null',
        최종값: finalMainDocumentId || 'null'
      });

      // 성공 시 문서 상태 업데이트 (보존된 main_document_id 명시적으로 유지)
      const { error: finalUpdateError } = await supabase
        .from('documents')
        .update({
          status: 'indexed',
          chunk_count: ragResult.chunkCount,
          main_document_id: finalMainDocumentId, // 보존된 그룹 관계 명시적으로 유지
          updated_at: new Date().toISOString(),
        })
        .eq('id', documentId);

      if (finalUpdateError) {
        console.error(`[CRITICAL] ❌ 최종 업데이트 실패:`, finalUpdateError);
      } else {
        console.log(`[CRITICAL] ✅ 최종 업데이트 완료: main_document_id=${finalMainDocumentId || 'null'}`);

        // 최종 업데이트 후 실제로 저장된 main_document_id 확인
        const { data: finalDoc, error: finalVerifyError } = await supabase
          .from('documents')
          .select('main_document_id, status, chunk_count')
          .eq('id', documentId)
          .maybeSingle();

        if (finalVerifyError) {
          console.error(`[CRITICAL] ❌ 최종 저장된 main_document_id 확인 실패:`, finalVerifyError);
        } else {
          console.log(`[CRITICAL] 🔍 최종 저장된 값 확인:`, {
            documentId,
            보존된값: mainDocumentIdToPreserve || 'null',
            원본문서값: document.main_document_id || 'null',
            최종설정값: finalMainDocumentId || 'null',
            실제저장값: finalDoc?.main_document_id || 'null',
            상태: finalDoc?.status,
            청크개수: finalDoc?.chunk_count,
            일치여부: finalMainDocumentId === finalDoc?.main_document_id
          });

          // 저장된 값이 예상과 다르면 경고
          if (finalMainDocumentId !== finalDoc?.main_document_id) {
            console.error(`[CRITICAL] ⚠️ 최종 main_document_id 불일치! 설정한 값: ${finalMainDocumentId || 'null'}, 실제 저장된 값: ${finalDoc?.main_document_id || 'null'}`);
          }
        }
      }

      // 재처리 완료 로그
      console.log(`[REPROCESS] ✅ 문서 재처리 완료:`, {
        documentId: document.id,
        documentTitle: document.title?.substring(0, 50),
        mainDocumentId: finalMainDocumentId || 'null',
        chunkCount: ragResult.chunkCount,
        timestamp: new Date().toISOString(),
      });

      console.log(`✅ URL 문서 재처리 완료: ${document.title} (청크: ${ragResult.chunkCount}개, main_document_id: ${finalMainDocumentId || 'null'})`);

      return NextResponse.json({
        success: true,
        message: 'URL 문서 재처리 완료',
        documentId: document.id,
        chunkCount: ragResult.chunkCount,
      });
    } else {
      // 실패 시 문서 상태 업데이트 (보존된 main_document_id 명시적으로 유지)
      // RAG 처리 중 변경되었을 수 있으므로 현재 DB 값 확인
      const { data: currentDoc } = await supabase
        .from('documents')
        .select('main_document_id')
        .eq('id', documentId)
        .maybeSingle();

      // 보존된 값이 있으면 항상 우선 사용 (재처리 시 그룹 관계 유지)
      const finalMainDocumentId = mainDocumentIdToPreserve ?? currentDoc?.main_document_id ?? null;

      console.log(`[CRITICAL] 📌 실패 시 main_document_id 유지:`, {
        보존된값: mainDocumentIdToPreserve || 'null',
        현재DB값: currentDoc?.main_document_id || 'null',
        최종값: finalMainDocumentId || 'null'
      });

      await supabase
        .from('documents')
        .update({
          status: 'failed',
          main_document_id: finalMainDocumentId, // 보존된 그룹 관계 명시적으로 유지
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

