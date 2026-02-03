/**
 * URL 크롤링 API
 * Meta 공식 사이트 크롤링을 위한 전용 엔드포인트
 */

import { NextRequest, NextResponse } from 'next/server';
import { newDocumentProcessor } from '@/lib/services/NewDocumentProcessor';

// Vercel 설정
export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * URL 크롤링 및 처리
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🌐 URL 크롤링 API 시작');

    const body = await request.json();
    const { urls, template } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { 
          success: false,
          error: '크롤링할 URL 목록이 제공되지 않았습니다.' 
        },
        { status: 400 }
      );
    }

    console.log(`📋 크롤링 요청: ${urls.length}개 URL`, { template });

    const results = [];
    const errors = [];

    // URL들을 순차적으로 처리 (동시 처리 시 서버 부하 방지)
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      
      try {
        console.log(`🌐 URL 크롤링 시작 (${i + 1}/${urls.length}): ${url}`);
        
        // URL 처리
        const processedDocument = await newDocumentProcessor.processUrl(url);
        const documentId = await newDocumentProcessor.saveDocument(processedDocument);
        
        console.log(`✅ URL 크롤링 완료: ${url} -> ${documentId}`);
        
        results.push({
          url,
          documentId,
          title: processedDocument.title,
          chunksProcessed: processedDocument.chunks.length,
          status: 'completed'
        });

        // 처리 간격 (서버 부하 방지)
        if (i < urls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        console.error(`❌ URL 크롤링 실패: ${url}`, error);
        
        errors.push({
          url,
          error: error instanceof Error ? error.message : '알 수 없는 오류',
          status: 'failed'
        });
      }
    }

    console.log(`🎯 크롤링 완료: 성공 ${results.length}개, 실패 ${errors.length}개`);

    return NextResponse.json({
      success: true,
      message: `크롤링 완료: 성공 ${results.length}개, 실패 ${errors.length}개`,
      data: {
        results,
        errors,
        summary: {
          total: urls.length,
          success: results.length,
          failed: errors.length,
          template: template || 'custom'
        }
      }
    });

  } catch (error) {
    console.error('❌ URL 크롤링 API 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'URL 크롤링 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * 크롤링 템플릿 조회
 */
export async function GET(request: NextRequest) {
  try {
    console.log('📋 크롤링 템플릿 조회');

    // Meta 공식 사이트 템플릿
    const templates = {
      'facebook-kr': {
        name: 'Facebook Business (한국어)',
        urls: [
          'https://ko-kr.facebook.com/business',
          'https://ko-kr.facebook.com/business/help',
        ],
        description: 'Facebook 비즈니스 한국어 도움말'
      },
      'instagram-kr': {
        name: 'Instagram Business (한국어)',
        urls: [
          'https://business.instagram.com/help/ko/',
        ],
        description: 'Instagram 비즈니스 한국어 도움말'
      },
      'facebook-en': {
        name: 'Facebook Business (영어)',
        urls: [
          'https://www.facebook.com/help/',
          'https://www.facebook.com/business/help/',
        ],
        description: 'Facebook 비즈니스 영어 도움말'
      },
      'instagram-en': {
        name: 'Instagram Business (영어)',
        urls: [
          'https://business.instagram.com/help/',
        ],
        description: 'Instagram 비즈니스 영어 도움말'
      },
      'meta-developer': {
        name: 'Meta 개발자 문서 (한국어)',
        urls: [
          'https://developers.facebook.com/docs/marketing-api',
        ],
        description: 'Meta 마케팅 API 개발자 문서'
      },
      'meta-ads': {
        name: 'Meta 광고 정책',
        urls: [
          'https://www.facebook.com/policies/ads/',
          'https://business.instagram.com/help/instagram/167825163240055',
        ],
        description: 'Meta 광고 정책 및 가이드라인'
      }
    };

    return NextResponse.json({
      success: true,
      data: {
        templates,
        totalTemplates: Object.keys(templates).length
      }
    });

  } catch (error) {
    console.error('❌ 템플릿 조회 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '크롤링 템플릿 조회 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
