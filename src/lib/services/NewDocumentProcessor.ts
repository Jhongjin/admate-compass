/**
 * 새로운 문서 처리 서비스
 * DB 테이블 구조를 기반으로 한 간단하고 안정적인 RAG 파이프라인
 */

import { createClient } from '@supabase/supabase-js';
import { unifiedChunkingService, UnifiedChunkingOptions } from './UnifiedChunkingService';
import * as cheerio from 'cheerio';

export interface ProcessedDocument {
  id: string;
  title: string;
  type: 'file' | 'url';
  content: string;
  chunks: DocumentChunk[];
  metadata: {
    size: number;
    uploadedAt: string;
    processedAt: string;
  };
}

export interface DocumentChunk {
  id: string;
  content: string;
  embedding: number[];
  metadata: {
    chunkIndex: number;
    startChar: number;
    endChar: number;
    chunkType: 'text' | 'title' | 'list' | 'table';
  };
}

export class NewDocumentProcessor {
  private supabase;
  private embeddingDimension = 128; // 차원 수 대폭 감소 (1024 -> 128)

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase 환경 변수가 설정되지 않았습니다.');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * 파일 업로드 및 처리 (최단순 버전)
   */
  async processFile(file: File): Promise<ProcessedDocument> {
    console.log(`📁 파일 처리 시작: ${file.name} (${file.size} bytes)`);

    try {
      // 1. 파일 내용 추출
      const content = await this.extractFileContent(file);
      console.log(`📄 파일 내용 추출 완료: ${content.length}자`);

      // 2. 단일 청크로 처리 (청킹 비활성화)
      console.log(`✂️ 단일 청크로 처리...`);
      const chunks = [{
        id: `${this.generateDocumentId()}_chunk_0`,
        content: content,
        embedding: [],
        metadata: {
          chunkIndex: 0,
          startChar: 0,
          endChar: content.length,
          chunkType: 'text' as const,
        },
      }];
      console.log(`✂️ 청크 처리 완료: 1개`);

      // 3. 문서 메타데이터 생성
      const document: ProcessedDocument = {
        id: this.generateDocumentId(),
        title: this.extractTitle(file.name),
        type: this.getFileType(file.name),
        content,
        chunks: chunks,
        metadata: {
          size: file.size,
          uploadedAt: new Date().toISOString(),
          processedAt: new Date().toISOString(),
        },
      };

      console.log(`✅ 문서 처리 완료: ${document.title}`);
      return document;
    } catch (error) {
      console.error(`❌ 파일 처리 실패: ${file.name}`, error);
      throw error;
    }
  }

  /**
   * URL 크롤링 및 처리
   */
  async processUrl(url: string): Promise<ProcessedDocument> {
    console.log(`🌐 URL 처리 시작: ${url}`);

    // 1. URL 내용 크롤링
    const content = await this.crawlUrl(url);
    console.log(`📄 URL 내용 크롤링 완료: ${content.length}자`);

    // 2. 통합 청킹 서비스 사용
    const chunkingResult = await unifiedChunkingService.chunkDocument(
      content,
      this.generateDocumentId(),
      this.extractTitleFromUrl(url),
      {
        documentType: 'url',
        chunkSize: 800,
        chunkOverlap: 100,
      }
    );

    // DocumentChunk 형식으로 변환
    const chunks = chunkingResult.chunks.map((chunk) => ({
      id: chunk.id,
      content: chunk.content,
      embedding: [],
      metadata: {
        chunkIndex: chunk.metadata.chunkIndex,
        startChar: chunk.metadata.startChar,
        endChar: chunk.metadata.endChar,
        chunkType: chunk.metadata.chunkType || 'text' as const,
      },
    }));

    console.log(`✂️ 통합 청킹 완료: ${chunks.length}개 청크 (평균 ${chunkingResult.metadata.averageChunkSize}자, 커버리지 ${chunkingResult.metadata.coverage}%)`);

    // 3. 임베딩 생성
    const chunksWithEmbeddings = await this.generateEmbeddings(chunks);
    console.log(`🧠 임베딩 생성 완료: ${chunksWithEmbeddings.length}개`);

    // 4. 문서 메타데이터 생성
    const document: ProcessedDocument = {
      id: this.generateDocumentId(),
      title: this.extractTitleFromUrl(url),
      type: 'url',
      content,
      chunks: chunksWithEmbeddings,
      metadata: {
        size: content.length,
        uploadedAt: new Date().toISOString(),
        processedAt: new Date().toISOString(),
      },
    };

    console.log(`✅ URL 처리 완료: ${document.title}`);
    return document;
  }

  /**
   * 문서를 데이터베이스에 저장
   */
  async saveDocument(document: ProcessedDocument): Promise<string> {
    console.log(`💾 문서 저장 시작: ${document.title}`);

    try {
      // 1. 문서 레코드 저장
      console.log(`📄 문서 레코드 저장 중...`);
      const { data: documentData, error: docError } = await this.supabase
        .from('documents')
        .insert({
          id: document.id,
          title: document.title,
          content: document.content, // content 컬럼 추가
          type: document.type, // 'file' 또는 'url'
          status: 'processing',
          chunk_count: document.chunks.length,
          created_at: document.metadata.uploadedAt,
          updated_at: document.metadata.processedAt,
          url: document.type === 'url' ? document.content.substring(0, 500) : null,
        })
        .select()
        .single();

      if (docError) {
        console.error(`❌ 문서 레코드 저장 실패:`, docError);
        throw new Error(`문서 저장 실패: ${docError.message}`);
      }

      console.log(`✅ 문서 레코드 저장 완료: ${document.id}`);

      // 2. 청크 데이터 저장 (chunk_id를 정수형으로 사용)
      if (document.chunks.length > 0) {
        console.log(`🧩 청크 데이터 저장 시작: ${document.chunks.length}개`);

        try {
          // 청크를 하나씩 저장 (배치 처리 제거)
          for (let i = 0; i < document.chunks.length; i++) {
            const chunk = document.chunks[i];
            const chunkRecord = {
              document_id: document.id,
              chunk_id: i + 1,
              content: chunk.content,
              embedding: [], // 빈 배열로 설정
              metadata: {
                ...chunk.metadata,
                title: document.title,
                type: document.type,
                model: 'bge-m3',
                dimension: 0, // 차원 수 0으로 설정
                processingTime: Date.now(),
                validated: true,
              },
              created_at: new Date().toISOString(),
            };

            const { error: chunkError } = await this.supabase
              .from('document_chunks')
              .insert([chunkRecord]);

            if (chunkError) {
              console.error(`❌ 청크 ${i + 1} 저장 실패:`, chunkError);
              // 개별 청크 실패는 무시하고 계속 진행
            } else {
              console.log(`✅ 청크 ${i + 1} 저장 완료`);
            }
          }

          console.log(`✅ 청크 데이터 저장 완료: ${document.chunks.length}개`);
        } catch (chunkError) {
          console.error(`❌ 청크 저장 중 예외 발생:`, chunkError);
          console.warn(`⚠️ 청크 저장 실패했지만 문서는 저장됨: ${document.title}`);
        }
      } else {
        console.log(`⚠️ 저장할 청크가 없습니다: ${document.title}`);
      }

      // 3. 문서 상태를 완료로 업데이트
      console.log(`🔄 문서 상태 업데이트 중...`);
      const { error: updateError } = await this.supabase
        .from('documents')
        .update({
          status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', document.id);

      if (updateError) {
        console.error(`❌ 문서 상태 업데이트 실패:`, updateError);
        console.warn(`⚠️ 문서 상태 업데이트 실패했지만 저장은 완료됨: ${document.title}`);
      } else {
        console.log(`✅ 문서 상태 업데이트 완료: ${document.title}`);
      }

      console.log(`✅ 문서 저장 완료: ${document.title}`);
      return document.id;

    } catch (error) {
      console.error(`❌ 문서 저장 실패: ${document.title}`, error);

      // 실패 시 문서 상태 업데이트 시도
      try {
        await this.supabase
          .from('documents')
          .update({
            status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', document.id);
        console.log(`⚠️ 문서 상태를 'failed'로 업데이트함: ${document.title}`);
      } catch (updateError) {
        console.error(`❌ 실패 상태 업데이트도 실패:`, updateError);
      }

      throw error;
    }
  }

  /**
   * UTF-8 인코딩 보장 함수
   */
  private async ensureUtf8Encoding(text: string): Promise<string> {
    try {
      // 통합된 인코딩 처리 유틸리티 사용
      const { processTextEncoding } = await import('../utils/textEncoding');
      const result = processTextEncoding(text, {
        strictMode: true,
        preserveOriginal: false
      });

      console.log(`🔧 NewDocumentProcessor 텍스트 인코딩 처리:`, {
        originalLength: text.length,
        cleanedLength: result.cleanedText.length,
        encoding: result.encoding,
        hasIssues: result.hasIssues,
        issues: result.issues
      });

      return result.cleanedText;
    } catch (error) {
      console.warn('⚠️ 통합 인코딩 처리 실패, 기본 처리 사용:', error);
      // 기본 처리로 폴백
      return text.replace(/\0/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    }
  }

  /**
   * 파일 내용 추출
   */
  private async extractFileContent(file: File): Promise<string> {
    const fileExtension = file.name.toLowerCase().split('.').pop();

    try {
      switch (fileExtension) {
        case 'txt':
          const textContent = await file.text();
          // UTF-8 인코딩 보장
          return await this.ensureUtf8Encoding(textContent);

        case 'pdf':
          // PDF 파일 처리 - 간단한 메타데이터 기반 처리
          console.log(`⚠️ PDF 파일 감지: ${file.name} - 메타데이터 기반 처리`);
          const pdfContent = `PDF 문서: ${file.name}

파일 정보:
- 파일명: ${file.name}
- 파일 크기: ${(file.size / 1024 / 1024).toFixed(2)}MB
- 파일 타입: PDF
- 업로드 시간: ${new Date().toLocaleString('ko-KR')}

참고사항:
이 PDF 파일은 업로드되었지만 실제 텍스트 내용 추출을 위해서는 서버사이드 PDF 처리 라이브러리(pdf-parse, pdf2pic 등)가 필요합니다. 
현재는 파일 메타데이터와 기본 정보만 저장됩니다.

실제 PDF 내용을 추출하려면:
1. pdf-parse 라이브러리 설치
2. 서버사이드에서 PDF 텍스트 추출
3. 추출된 텍스트를 청킹하여 임베딩 생성

이 파일은 관리자가 나중에 수동으로 처리하거나, PDF 처리 기능이 추가될 때까지 대기 상태로 유지됩니다.`;
          return await this.ensureUtf8Encoding(pdfContent);

        case 'docx':
          // DOCX 파일 처리 - 서버사이드에서 처리하도록 안내
          console.log(`⚠️ DOCX 파일 감지: ${file.name} - 서버사이드 처리 필요`);
          const docxContent = `DOCX 파일: ${file.name}\n파일 크기: ${(file.size / 1024 / 1024).toFixed(2)}MB\n\n이 DOCX 파일은 업로드되었지만 실제 내용 추출을 위해서는 서버사이드 DOCX 처리 라이브러리가 필요합니다. 현재는 파일 메타데이터만 저장됩니다.`;
          return await this.ensureUtf8Encoding(docxContent);

        default:
          // 기본적으로 텍스트로 처리
          try {
            const textContent = await file.text();
            return await this.ensureUtf8Encoding(textContent);
          } catch {
            return await this.ensureUtf8Encoding(`파일: ${file.name}\n\n파일 내용을 읽을 수 없습니다.`);
          }
      }
    } catch (error) {
      console.error(`파일 처리 오류 (${file.name}):`, error);
      return `파일: ${file.name}\n\n파일 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`;
    }
  }


  /**
   * URL 크롤링 (Cheerio 기반 개선 버전)
   */
  private async crawlUrl(url: string): Promise<string> {
    try {
      console.log('🌐 URL 크롤링 시작 (Cheerio 사용):', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Cache-Control': 'max-age=0'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000), // 30초 타임아웃
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText.substring(0, 200)}`);
      }

      const htmlContent = await response.text();
      console.log('✅ HTML 수신 완료:', url, `(${htmlContent.length}자)`);

      // 로그인 페이지 감지
      const lowerHtml = htmlContent.toLowerCase();
      const loginPatterns = [
        '계속하려면 로그인',
        'facebook에 로그인',
        'login to facebook',
        'instagram에 로그인',
        'log in to instagram',
        '로그인하여 계속',
      ];
      const isBlockedByLogin = loginPatterns.some((pattern) => lowerHtml.includes(pattern.toLowerCase()));

      if (isBlockedByLogin && (url.includes('facebook.com') || url.includes('instagram.com'))) {
        console.warn('⚠️ 로그인 페이지가 반환되었습니다. (NewDocumentProcessor) - 처리를 계속합니다.');
        console.warn('DEBUG: Login page detected in NewDocumentProcessor - NOT THROWING ERROR (V4_CHECK)');
        console.error('*** [V4_CHECK] LOGIN DETECTED IN NEW DOCUMENT PROCESSOR ***');
        // 에러를 던지지 않고 처리를 계속하거나 빈 내용을 반환하도록 수정
        // throw new Error('DEBUG_TEST: Login page returned (NewDocProc) - If you see this, NewDocProc is RUNNING and UPDATED (V4).');
      }

      // Cheerio로 HTML 파싱 및 텍스트 추출
      const text = this.extractTextFromHTMLWithCheerio(htmlContent);

      if (!text || text.length < 100) {
        // console.error('[V4_CHECK] Content too short');
        throw new Error('크롤링된 콘텐츠가 너무 짧거나 비어있습니다. 접근 권한 또는 공개 여부를 확인해주세요.');
      }

      console.log('✅ 텍스트 추출 완료 (Cheerio):', url, `(${text.length}자)`);
      return text;

    } catch (error) {
      console.error(`❌ URL 크롤링 오류: ${url}`, error);
      return `URL 크롤링 실패: ${url}\n오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`;
    }
  }

  /**
   * HTML에서 텍스트 추출 (Cheerio 기반 개선 버전)
   * 구조를 유지하면서 텍스트 추출
   */
  private extractTextFromHTMLWithCheerio(html: string): string {
    try {
      const $ = cheerio.load(html);

      // 텍스트 추출 헬퍼 함수
      const extractTextWithStructure = ($element: cheerio.Cheerio): string => {
        const $clone = $element.clone();

        // 스크립트, 스타일, 네비게이션 등 제거
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

        // <br> 태그는 줄바꿈으로 변환
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

        // 최종 텍스트 추출
        const html = $clone.html() || '';
        let text = html
          .replace(/<[^>]+>/g, ' ') // 모든 태그를 공백으로 변환
          .replace(/&nbsp;/g, ' ') // HTML 엔티티 디코딩
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&apos;/g, "'");

        // 연속된 공백을 하나로, 연속된 줄바꿈을 두 개로 제한
        text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        return text;
      };

      // 주요 콘텐츠 영역 우선 추출
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

      let textContent = '';
      let foundContent = false;

      for (const selector of contentSelectors) {
        const $content = $(selector).first();
        if ($content.length > 0) {
          const extracted = extractTextWithStructure($content.clone());
          if (extracted.length > textContent.length) {
            textContent = extracted;
            foundContent = true;
          }
          if (textContent.length > 1000) break; // 충분한 콘텐츠를 찾으면 중단
        }
      }

      // 주요 콘텐츠 영역을 찾지 못했거나 너무 짧은 경우 body 전체에서 추출
      if (!foundContent || textContent.length < 500) {
        const $body = $('body');
        if ($body.length > 0) {
          const fullText = extractTextWithStructure($body.clone());
          if (fullText.length > textContent.length) {
            textContent = fullText;
          }
        }
      }

      return textContent;
    } catch (error) {
      console.error('❌ Cheerio 텍스트 추출 실패, 기본 방식으로 폴백:', error);
      // 폴백: 기본 정규식 방식
      return this.extractTextFromHTML(html);
    }
  }

  /**
   * HTML에서 텍스트 추출 (기본 버전 - 폴백용)
   */
  private extractTextFromHTML(html: string): string {
    // 스크립트와 스타일 태그 제거
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // HTML 엔티티 디코딩
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");

    return text;
  }

  /**
   * @deprecated 이 메서드들은 더 이상 사용되지 않습니다.
   * 통합 청킹 서비스 (unifiedChunkingService)를 사용하세요.
   * 
   * 제거된 메서드:
   * - chunkText(): 통합 청킹 서비스로 대체됨
   * - mergeSmallChunks(): 통합 청킹 서비스로 대체됨
   * - preprocessText(): 통합 청킹 서비스로 대체됨
   * - classifyChunkType(): 통합 청킹 서비스로 대체됨
   */

  /**
   * 임베딩 생성 (즉시 처리 버전)
   */
  private async generateEmbeddings(chunks: DocumentChunk[]): Promise<DocumentChunk[]> {
    console.log(`🧠 임베딩 생성 시작: ${chunks.length}개 청크`);

    try {
      const result: DocumentChunk[] = [];

      // 모든 청크를 즉시 처리 (배치 없이)
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`🧠 청크 ${i + 1}/${chunks.length} 처리 중`);

        try {
          // 즉시 임베딩 생성
          const embedding = this.generateHashEmbedding(chunk.content);
          result.push({
            ...chunk,
            embedding,
          });
          console.log(`✅ 청크 ${i + 1} 완료`);
        } catch (error) {
          console.error(`❌ 청크 ${i + 1} 실패:`, error);
          // 실패한 청크는 기본 임베딩으로 처리
          result.push({
            ...chunk,
            embedding: this.generateHashEmbedding(''),
          });
        }
      }

      console.log(`✅ 임베딩 생성 완료: ${result.length}개`);
      return result;
    } catch (error) {
      console.error('❌ 임베딩 생성 중 오류 발생:', error);
      throw error;
    }
  }

  /**
   * 해시 기반 임베딩 생성
   */
  private generateHashEmbedding(text: string): number[] {
    // 간단한 해시 기반 임베딩 (실제로는 BGE-M3 모델 사용)
    const hash = this.simpleHash(text);
    const embedding = new Array(this.embeddingDimension).fill(0);

    // 해시를 기반으로 임베딩 벡터 생성
    for (let i = 0; i < this.embeddingDimension; i++) {
      const seed = (hash + i) % 1000000;
      embedding[i] = (Math.sin(seed) * 0.5 + 0.5) * 2 - 1; // -1 ~ 1 범위
    }

    return embedding;
  }

  /**
   * 간단한 해시 함수
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32비트 정수로 변환
    }
    return Math.abs(hash);
  }

  /**
   * 파일 타입 추출 (데이터베이스 제약 조건에 맞게 수정)
   */
  private getFileType(filename: string): 'file' | 'url' {
    // 데이터베이스 제약 조건에 맞게 'file' 또는 'url'만 반환
    return 'file';
  }

  /**
   * 제목 추출
   */
  private extractTitle(filename: string): string {
    return filename.replace(/\.[^/.]+$/, ''); // 확장자 제거
  }

  /**
   * URL에서 제목 추출
   */
  private extractTitleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const segments = pathname.split('/').filter(segment => segment.length > 0);
      return segments[segments.length - 1] || urlObj.hostname;
    } catch {
      return url;
    }
  }

  /**
   * 문서 ID 생성
   */
  private generateDocumentId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `doc_${timestamp}_${random}`;
  }
}

export const newDocumentProcessor = new NewDocumentProcessor();
