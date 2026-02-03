import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    console.log('🧪 필터링 로직 테스트 시작...');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase 환경변수가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 모든 문서 조회
    const { data: allDocs, error: allDocsError } = await supabase
      .from('documents')
      .select('id, title, url, status, type, created_at')
      .order('created_at', { ascending: false });

    if (allDocsError) {
      console.error('❌ 모든 문서 조회 실패:', allDocsError);
      return NextResponse.json(
        { error: '문서 조회 실패', details: allDocsError },
        { status: 500 }
      );
    }

    console.log('📋 전체 문서 수:', allDocs.length);

    // 각 필터링 조건별로 테스트
    const tests = {
      // 1. title에 facebook.com이 포함된 문서들
      facebookInTitle: allDocs.filter(doc => 
        doc.title && doc.title.includes('facebook.com')
      ),
      
      // 2. title에 instagram.com이 포함된 문서들
      instagramInTitle: allDocs.filter(doc => 
        doc.title && doc.title.includes('instagram.com')
      ),
      
      // 3. title에 meta.com이 포함된 문서들
      metaInTitle: allDocs.filter(doc => 
        doc.title && doc.title.includes('meta.com')
      ),
      
      // 4. title에 developers.facebook.com이 포함된 문서들
      developersFacebookInTitle: allDocs.filter(doc => 
        doc.title && doc.title.includes('developers.facebook.com')
      ),
      
      // 5. title에 business.instagram.com이 포함된 문서들
      businessInstagramInTitle: allDocs.filter(doc => 
        doc.title && doc.title.includes('business.instagram.com')
      ),
      
      // 6. 전체 Meta 관련 문서들 (OR 조건)
      allMetaDocs: allDocs.filter(doc => 
        doc.title && (
          doc.title.includes('facebook.com') || 
          doc.title.includes('instagram.com') || 
          doc.title.includes('meta.com') ||
          doc.title.includes('developers.facebook.com') ||
          doc.title.includes('business.instagram.com')
        )
      )
    };

    // 각 테스트 결과 출력
    console.log('🧪 필터링 테스트 결과:');
    console.log('  - facebook.com in title:', tests.facebookInTitle.length);
    console.log('  - instagram.com in title:', tests.instagramInTitle.length);
    console.log('  - meta.com in title:', tests.metaInTitle.length);
    console.log('  - developers.facebook.com in title:', tests.developersFacebookInTitle.length);
    console.log('  - business.instagram.com in title:', tests.businessInstagramInTitle.length);
    console.log('  - 전체 Meta 문서들:', tests.allMetaDocs.length);

    // 실제 문서 제목들 출력
    console.log('📝 facebook.com이 포함된 문서 제목들:');
    tests.facebookInTitle.forEach(doc => {
      console.log(`  - ${doc.title}`);
    });

    console.log('📝 instagram.com이 포함된 문서 제목들:');
    tests.instagramInTitle.forEach(doc => {
      console.log(`  - ${doc.title}`);
    });

    console.log('📝 전체 Meta 문서 제목들:');
    tests.allMetaDocs.forEach(doc => {
      console.log(`  - ${doc.title} (status: ${doc.status})`);
    });

    return NextResponse.json({
      success: true,
      totalDocuments: allDocs.length,
      testResults: {
        facebookInTitle: tests.facebookInTitle.length,
        instagramInTitle: tests.instagramInTitle.length,
        metaInTitle: tests.metaInTitle.length,
        developersFacebookInTitle: tests.developersFacebookInTitle.length,
        businessInstagramInTitle: tests.businessInstagramInTitle.length,
        allMetaDocs: tests.allMetaDocs.length
      },
      sampleDocuments: {
        facebookDocs: tests.facebookInTitle.slice(0, 3),
        instagramDocs: tests.instagramInTitle.slice(0, 3),
        allMetaDocs: tests.allMetaDocs.slice(0, 5)
      }
    });

  } catch (error) {
    console.error('❌ 필터링 테스트 오류:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: '필터링 테스트 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

