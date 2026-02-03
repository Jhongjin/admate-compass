import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    console.log('🔄 URL 필드 업데이트 시작...');

    // URL이 null인 문서들 조회
    const { data: documents, error: fetchError } = await supabase
      .from('documents')
      .select('*')
      .eq('type', 'url')
      .is('url', null);

    if (fetchError) {
      console.error('❌ 문서 조회 오류:', fetchError);
      throw new Error(`문서 조회 실패: ${fetchError.message}`);
    }

    console.log(`📋 URL이 null인 문서 ${documents?.length || 0}개 발견`);

    if (!documents || documents.length === 0) {
      return NextResponse.json({
        success: true,
        message: '업데이트할 문서가 없습니다.',
        updatedCount: 0
      });
    }

    // 각 문서의 URL을 title에서 추출하여 업데이트
    let updatedCount = 0;
    const errors = [];

    for (const doc of documents) {
      try {
        // title에서 URL 패턴 추출 시도
        let extractedUrl = null;
        
        // title이 URL 패턴을 포함하는지 확인
        const urlPattern = /https?:\/\/[^\s]+/;
        const match = doc.title.match(urlPattern);
        
        if (match) {
          extractedUrl = match[0];
        } else {
          // title이 URL 패턴이 아닌 경우, 알려진 Meta URL들 중에서 매칭
          const knownUrls = [
            'https://ko-kr.facebook.com/business',
            'https://business.instagram.com/help/ko/',
            'https://www.facebook.com/help/',
            'https://www.facebook.com/business/help/',
            'https://business.instagram.com/help/',
            'https://developers.facebook.com/docs/marketing-api'
          ];
          
          // title과 가장 유사한 URL 찾기
          const titleLower = doc.title.toLowerCase();
          for (const knownUrl of knownUrls) {
            if (titleLower.includes('facebook') && knownUrl.includes('facebook')) {
              extractedUrl = knownUrl;
              break;
            } else if (titleLower.includes('instagram') && knownUrl.includes('instagram')) {
              extractedUrl = knownUrl;
              break;
            } else if (titleLower.includes('marketing') && knownUrl.includes('marketing')) {
              extractedUrl = knownUrl;
              break;
            }
          }
        }

        if (extractedUrl) {
          const { error: updateError } = await supabase
            .from('documents')
            .update({ url: extractedUrl })
            .eq('id', doc.id);

          if (updateError) {
            console.error(`❌ 문서 ${doc.id} 업데이트 실패:`, updateError);
            errors.push({ id: doc.id, error: updateError.message });
          } else {
            console.log(`✅ 문서 ${doc.id} URL 업데이트: ${extractedUrl}`);
            updatedCount++;
          }
        } else {
          console.warn(`⚠️ 문서 ${doc.id}의 URL을 추출할 수 없음: ${doc.title}`);
        }
      } catch (error) {
        console.error(`❌ 문서 ${doc.id} 처리 중 오류:`, error);
        errors.push({ id: doc.id, error: error instanceof Error ? error.message : String(error) });
      }
    }

    console.log(`✅ URL 업데이트 완료: ${updatedCount}개 성공, ${errors.length}개 실패`);

    return NextResponse.json({
      success: true,
      message: `${updatedCount}개 문서의 URL이 업데이트되었습니다.`,
      updatedCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('❌ URL 업데이트 중 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'URL 업데이트 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}


