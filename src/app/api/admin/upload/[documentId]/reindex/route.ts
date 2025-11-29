/**
 * 문서 재인덱싱 API
 * 
 * URL 문서의 경우 실제 크롤링과 RAG 처리를 수행합니다.
 * 파일 문서의 경우 기존 content를 사용하여 RAG 처리를 수행합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';
import { RAGProcessor } from '@/lib/services/RAGProcessor';
import { PuppeteerCrawlingService } from '@/lib/services/PuppeteerCrawlingService';
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5분
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    
    if (!documentId) {
      return NextResponse.json(
        { success: false, error: '문서 ID가 필요합니다.' },
        { status: 400 }
      );
    }

    console.log(`🔄 재인덱싱 요청: ${documentId}`);

    const supabase = await createPureClient();

    // 문서 정보 조회
    console.log(`📋 문서 정보 조회 중: ${documentId}`);
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, title, content, url, document_url, type, source_vendor, main_document_id, status, created_at')
      .eq('id', documentId)
      .maybeSingle();

    if (docError) {
      console.error('❌ 문서 조회 실패:', docError);
      return NextResponse.json(
        { success: false, error: `문서 조회 실패: ${docError.message}` },
        { status: 404 }
      );
    }

    if (!document) {
      console.error('❌ 문서를 찾을 수 없음');
      return NextResponse.json(
        { success: false, error: '문서를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    console.log(`📄 재인덱싱 대상 문서: ${document.title} (${document.url || document.document_url || 'N/A'})`);

    // 기존 청크 삭제
    console.log(`🗑️ 기존 청크 삭제 중...`);
    const { error: deleteError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', documentId);

    if (deleteError) {
      console.error('❌ 청크 삭제 실패:', deleteError);
      return NextResponse.json(
        { success: false, error: `기존 청크 삭제 실패: ${deleteError.message}` },
        { status: 500 }
      );
    }

    console.log(`✅ 기존 청크 삭제 완료`);

    // 문서 상태를 'processing'으로 업데이트
    console.log(`🔄 문서 상태를 'processing'으로 업데이트 중...`);
    const { error: statusError } = await supabase
      .from('documents')
      .update({ 
        status: 'processing',
        chunk_count: 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);

    if (statusError) {
      console.error('❌ 문서 상태 업데이트 실패:', statusError);
      return NextResponse.json(
        { success: false, error: `문서 상태 업데이트 실패: ${statusError.message}` },
        { status: 500 }
      );
    }

    console.log(`✅ 문서 상태 업데이트 완료`);

    // 문서 타입에 따른 재인덱싱 처리
    if (document.type === 'url') {
      const effectiveUrl = document.url || document.document_url;
      
      if (!effectiveUrl) {
        return NextResponse.json(
          { success: false, error: 'URL 문서에 URL 정보가 없습니다.' },
          { status: 400 }
        );
      }

      console.log(`🌐 URL 재인덱싱 시작: ${effectiveUrl}`);
      
      try {
        // URL 크롤링
        const crawlingService = new PuppeteerCrawlingService();
        const crawledData = await crawlingService.crawlMetaPage(effectiveUrl, false, false, 1);
        
        if (!crawledData || !crawledData.content) {
          throw new Error('URL 크롤링 실패: 콘텐츠를 가져올 수 없습니다.');
        }

        console.log(`✅ URL 크롤링 완료: ${crawledData.content.length}자`);

        // 제목 추출 (크롤링된 제목 우선, 없으면 기존 제목 사용)
        let pageTitle = crawledData.title || document.title;
        
        // HTML에서 제목 추출 시도
        if (!pageTitle || pageTitle === effectiveUrl) {
          try {
            const $ = cheerio.load(crawledData.content);
            pageTitle = $('h1').first().text().trim() || 
                       $('title').text().trim() || 
                       $('meta[property="og:title"]').attr('content')?.trim() ||
                       document.title;
          } catch (e) {
            console.warn('⚠️ HTML 파싱 실패, 기존 제목 사용');
          }
        }

        // main_document_id 보존
        const mainDocumentIdToPreserve = document.main_document_id;

        // RAG 처리
        const ragProcessor = new RAGProcessor();
        const ragResult = await ragProcessor.processDocument({
          id: document.id,
          title: pageTitle,
          content: crawledData.content,
          type: 'url',
          file_size: Buffer.byteLength(crawledData.content, 'utf8'),
          file_type: 'text/html',
          url: effectiveUrl,
          source_vendor: document.source_vendor || 'META',
          main_document_id: mainDocumentIdToPreserve,
          created_at: document.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        if (ragResult.success) {
          // 문서 상태를 'indexed'로 업데이트
          const { error: finalStatusError } = await supabase
            .from('documents')
            .update({ 
              status: 'indexed',
              chunk_count: ragResult.chunkCount || 0,
              title: pageTitle,
              content: crawledData.content,
              updated_at: new Date().toISOString()
            })
            .eq('id', documentId);

          if (finalStatusError) {
            console.error('❌ 최종 상태 업데이트 실패:', finalStatusError);
            return NextResponse.json(
              { success: false, error: `최종 상태 업데이트 실패: ${finalStatusError.message}` },
              { status: 500 }
            );
          }

          console.log(`✅ 재인덱싱 완료: ${ragResult.chunkCount || 0}개 청크 생성`);

          return NextResponse.json({
            success: true,
            message: '재인덱싱이 완료되었습니다.',
            document: {
              id: document.id,
              title: pageTitle,
              url: effectiveUrl,
              type: document.type,
              chunkCount: ragResult.chunkCount || 0
            }
          });
        } else {
          // RAG 처리 실패
          await supabase
            .from('documents')
            .update({ 
              status: 'failed',
              updated_at: new Date().toISOString()
            })
            .eq('id', documentId);

          return NextResponse.json(
            { success: false, error: 'RAG 처리에 실패했습니다.' },
            { status: 500 }
          );
        }

      } catch (crawlError) {
        console.error('❌ 크롤링/인덱싱 오류:', crawlError);
        
        // 실패 시 상태를 failed로 변경
        await supabase
          .from('documents')
          .update({ 
            status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', documentId);
        
        return NextResponse.json(
          { 
            success: false,
            error: '재인덱싱에 실패했습니다.',
            details: crawlError instanceof Error ? crawlError.message : String(crawlError)
          },
          { status: 500 }
        );
      }

    } else if (document.type === 'file') {
      console.log(`📁 파일 재인덱싱 시작: ${document.title}`);
      
      if (!document.content || document.content.trim() === '') {
        return NextResponse.json(
          { success: false, error: '파일 문서에 콘텐츠가 없습니다. 파일을 다시 업로드해주세요.' },
          { status: 400 }
        );
      }

      try {
        // RAG 처리
        const ragProcessor = new RAGProcessor();
        const ragResult = await ragProcessor.processDocument({
          id: document.id,
          title: document.title,
          content: document.content,
          type: 'file',
          file_size: Buffer.byteLength(document.content, 'utf8'),
          file_type: 'text/plain',
          url: null,
          source_vendor: document.source_vendor || 'META',
          main_document_id: document.main_document_id,
          created_at: document.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        if (ragResult.success) {
          // 문서 상태를 'indexed'로 업데이트
          const { error: finalStatusError } = await supabase
            .from('documents')
            .update({ 
              status: 'indexed',
              chunk_count: ragResult.chunkCount || 0,
              updated_at: new Date().toISOString()
            })
            .eq('id', documentId);

          if (finalStatusError) {
            console.error('❌ 최종 상태 업데이트 실패:', finalStatusError);
            return NextResponse.json(
              { success: false, error: `최종 상태 업데이트 실패: ${finalStatusError.message}` },
              { status: 500 }
            );
          }

          console.log(`✅ 파일 재인덱싱 완료: ${ragResult.chunkCount || 0}개 청크 생성`);

          return NextResponse.json({
            success: true,
            message: '재인덱싱이 완료되었습니다.',
            document: {
              id: document.id,
              title: document.title,
              type: document.type,
              chunkCount: ragResult.chunkCount || 0
            }
          });
        } else {
          // RAG 처리 실패
          await supabase
            .from('documents')
            .update({ 
              status: 'failed',
              updated_at: new Date().toISOString()
            })
            .eq('id', documentId);

          return NextResponse.json(
            { success: false, error: 'RAG 처리에 실패했습니다.' },
            { status: 500 }
          );
        }

      } catch (processError) {
        console.error('❌ 파일 재인덱싱 오류:', processError);
        
        // 실패 시 상태를 failed로 변경
        await supabase
          .from('documents')
          .update({ 
            status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', documentId);
        
        return NextResponse.json(
          { 
            success: false,
            error: '재인덱싱에 실패했습니다.',
            details: processError instanceof Error ? processError.message : String(processError)
          },
          { status: 500 }
        );
      }
      
    } else {
      return NextResponse.json(
        { success: false, error: '지원하지 않는 문서 타입입니다.' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('재인덱싱 오류:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: '재인덱싱에 실패했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
