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

const STORAGE_BUCKET = 'documents';

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

    console.log(`🔄 재인덱싱 요청 시작: ${documentId}`);

    const supabase = await createPureClient();

    // 문서 정보 조회
    console.log(`📋 문서 정보 조회 중: ${documentId}`);
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, title, content, url, document_url, type, source_vendor, main_document_id, status, created_at, file_type, file_size, original_file_name, sanitized_file_name')
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

        // 재인덱싱 시에는 기존 제목을 우선 유지 (제목 변경 방지)
        // 크롤링된 제목은 참고용으로만 사용하고, 기존 제목이 있으면 그대로 유지
        let pageTitle = document.title; // 기존 제목 우선
        
        // 기존 제목이 없거나 URL과 같은 경우에만 크롤링된 제목 사용
        if (!pageTitle || pageTitle === effectiveUrl || pageTitle.trim() === '') {
          pageTitle = crawledData.title || document.title;
          
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
              pageTitle = document.title;
            }
          }
        }
        
        console.log(`📝 제목 결정: 기존="${document.title}", 최종="${pageTitle}"`);

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
      
      let contentToProcess = document.content || '';
      let fileType = document.file_type || 'text/plain';
      let fileSize = document.file_size || 0;
      
      // PDF/DOCX 파일의 경우 Storage에서 원본 파일을 가져와서 텍스트 추출 시도
      const fileName = document.original_file_name || document.sanitized_file_name || document.title;
      const fileExtension = fileName?.toLowerCase().split('.').pop();
      
      if ((fileExtension === 'pdf' || fileExtension === 'docx') && (!contentToProcess || contentToProcess.includes('PDF 문서:') || contentToProcess.includes('DOCX 문서:') || contentToProcess.includes('텍스트 추출이 비활성화'))) {
        console.log('📥 Storage에서 원본 파일 다운로드 시도:', fileName);
        
        try {
          // Storage에서 파일 찾기 (document_id로 경로 검색)
          const { data: files, error: listError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .list(documentId, {
              limit: 100,
              sortBy: { column: 'created_at', order: 'desc' }
            });
          
          if (!listError && files && files.length > 0) {
            // 가장 최근 파일 찾기
            const latestFile = files[0];
            const filePath = `${documentId}/${latestFile.name}`;
            
            console.log(`📥 Storage 파일 다운로드: ${filePath}`);
            const { data: fileData, error: downloadError } = await supabase.storage
              .from(STORAGE_BUCKET)
              .download(filePath);
            
            if (!downloadError && fileData) {
              const arrayBuffer = await fileData.arrayBuffer();
              const fileBuffer = Buffer.from(arrayBuffer);
              
              console.log(`✅ Storage 파일 다운로드 완료: ${fileBuffer.length} bytes`);
              
              // RAGProcessor의 extractTextFromFile 사용
              const ragProcessor = new RAGProcessor();
              const extractionResult = await ragProcessor.extractTextFromFile(
                fileBuffer,
                fileName,
                fileType
              );
              
              contentToProcess = extractionResult.cleanedText;
              fileSize = fileBuffer.length;
              fileType = fileExtension === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
              
              console.log(`✅ 텍스트 추출 완료: ${contentToProcess.length}자`);
            } else {
              console.warn('⚠️ Storage 파일 다운로드 실패, 기존 content 사용:', downloadError);
            }
          } else {
            console.warn('⚠️ Storage에서 파일을 찾을 수 없음, 기존 content 사용');
          }
        } catch (storageError) {
          console.error('❌ Storage 처리 오류:', storageError);
          // Storage 오류 시 기존 content 사용
        }
      }
      
      if (!contentToProcess || contentToProcess.trim() === '') {
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
          content: contentToProcess,
          type: 'file',
          file_size: fileSize || Buffer.byteLength(contentToProcess, 'utf8'),
          file_type: fileType,
          url: undefined,
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
    const documentId = await params.then(p => p.documentId).catch(() => 'unknown');
    console.error('❌ 재인덱싱 오류:', {
      documentId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return NextResponse.json(
      { 
        success: false,
        error: '재인덱싱에 실패했습니다.',
        message: errorMessage,
        details: error instanceof Error ? error.stack : String(error)
      },
      { status: 500 }
    );
  }
}
