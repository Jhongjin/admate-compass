/**
 * 실패한 URL 문서 재처리 API
 * 
 * 크롤링 중 실패한 하위 페이지 문서를 재처리합니다.
 * URL 문서는 PDF_PARSE/DOCX_PARSE가 아닌 RAG 처리를 다시 수행합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';
import { RAGProcessor } from '@/lib/services/RAGProcessor';
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
    if (!content || content.trim().length === 0) {
      console.log(`🔄 문서 콘텐츠가 비어있어 URL에서 다시 크롤링합니다: ${document.url}`);
      
      try {
        // URL에서 페이지 다운로드
        const response = await fetch(document.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          signal: AbortSignal.timeout(30000), // 30초 타임아웃
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const htmlContent = await response.text();
        const $ = cheerio.load(htmlContent);

        // 제목 추출
        let pageTitle = $('h1').first().text().trim() || 
                       $('title').text().trim() || 
                       $('meta[property="og:title"]').attr('content')?.trim() ||
                       document.title;

        // 텍스트 추출
        $('script, style, nav, footer, header, aside').remove();
        const textContent = $('body').text()
          .replace(/\s+/g, ' ')
          .trim();

        if (textContent.length === 0) {
          throw new Error('크롤링된 콘텐츠가 비어있습니다.');
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
      title: document.title,
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

