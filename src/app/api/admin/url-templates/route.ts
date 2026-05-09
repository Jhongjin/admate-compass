import { NextRequest, NextResponse } from 'next/server';
import { createCompassBrowserClient } from '@/lib/supabase/compass';

// 템플릿 조회
export async function GET() {
  try {
    const supabase = createCompassBrowserClient();

    const { data: templates, error } = await supabase
      .from('url_templates')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('템플릿 조회 오류:', error);
      // 테이블이 없는 경우 기본 템플릿 반환
      const defaultTemplates = {
        'Facebook Business (한국어)': ['https://ko-kr.facebook.com/business'],
        'Instagram Business (한국어)': ['https://business.instagram.com/help/ko/'],
        'Meta 개발자 문서 (한국어)': ['https://developers.facebook.com/docs/marketing-api/ko/'],
        'Facebook Help (영어)': ['https://www.facebook.com/help/'],
        'Facebook Business (영어)': ['https://www.facebook.com/business/help/'],
        'Instagram Business (영어)': ['https://business.instagram.com/help/'],
        'Meta 개발자 문서 (영어)': ['https://developers.facebook.com/docs/marketing-api/']
      };

      return NextResponse.json({
        success: true,
        templates: defaultTemplates
      });
    }

    // 배열을 객체로 변환
    const templateObject = templates.reduce((acc, template) => {
      acc[template.name] = template.urls;
      return acc;
    }, {} as { [key: string]: string[] });

    return NextResponse.json({
      success: true,
      templates: templateObject
    });

  } catch (error) {
    console.error('템플릿 조회 오류:', error);
    return NextResponse.json(
      { error: '템플릿 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}

// 템플릿 저장 (전체 교체)
export async function POST(request: NextRequest) {
  try {
    const { templates } = await request.json();

    if (!templates || typeof templates !== 'object') {
      return NextResponse.json(
        { error: '유효하지 않은 템플릿 데이터입니다.' },
        { status: 400 }
      );
    }

    const supabase = createCompassBrowserClient();

    // 기존 템플릿 모두 삭제
    const { error: deleteError } = await supabase
      .from('url_templates')
      .delete()
      .neq('id', 0); // 모든 레코드 삭제

    if (deleteError) {
      console.error('기존 템플릿 삭제 오류:', deleteError);
      return NextResponse.json(
        { error: '기존 템플릿 삭제에 실패했습니다.' },
        { status: 500 }
      );
    }

    // 새 템플릿들 삽입
    const templateEntries = Object.entries(templates).map(([name, urls]) => ({
      name,
      urls: urls as string[]
    }));

    if (templateEntries.length > 0) {
      const { error: insertError } = await supabase
        .from('url_templates')
        .insert(templateEntries);

      if (insertError) {
        console.error('템플릿 삽입 오류:', insertError);
        return NextResponse.json(
          { error: '템플릿 저장에 실패했습니다.' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: `${templateEntries.length}개 템플릿이 저장되었습니다.`
    });

  } catch (error) {
    console.error('템플릿 저장 오류:', error);
    return NextResponse.json(
      { error: '템플릿 저장에 실패했습니다.' },
      { status: 500 }
    );
  }
}

// 개별 템플릿 추가/수정
export async function PUT(request: NextRequest) {
  try {
    const { name, urls } = await request.json();

    if (!name || !Array.isArray(urls)) {
      return NextResponse.json(
        { error: '템플릿 이름과 URL 배열이 필요합니다.' },
        { status: 400 }
      );
    }

    const supabase = createCompassBrowserClient();

    // 템플릿이 존재하는지 확인
    const { data: existingTemplate, error: checkError } = await supabase
      .from('url_templates')
      .select('id')
      .eq('name', name)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('템플릿 확인 오류:', checkError);
      return NextResponse.json(
        { error: '템플릿 확인에 실패했습니다.' },
        { status: 500 }
      );
    }

    if (existingTemplate) {
      // 기존 템플릿 업데이트
      const { error: updateError } = await supabase
        .from('url_templates')
        .update({ urls })
        .eq('name', name);

      if (updateError) {
        console.error('템플릿 업데이트 오류:', updateError);
        return NextResponse.json(
          { error: '템플릿 업데이트에 실패했습니다.' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: '템플릿이 업데이트되었습니다.'
      });
    } else {
      // 새 템플릿 추가
      const { error: insertError } = await supabase
        .from('url_templates')
        .insert({ name, urls });

      if (insertError) {
        console.error('템플릿 추가 오류:', insertError);
        return NextResponse.json(
          { error: '템플릿 추가에 실패했습니다.' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: '템플릿이 추가되었습니다.'
      });
    }

  } catch (error) {
    console.error('템플릿 처리 오류:', error);
    return NextResponse.json(
      { error: '템플릿 처리에 실패했습니다.' },
      { status: 500 }
    );
  }
}

// 개별 템플릿 삭제
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');

    if (!name) {
      return NextResponse.json(
        { error: '템플릿 이름이 필요합니다.' },
        { status: 400 }
      );
    }

    const supabase = createCompassBrowserClient();

    const { error } = await supabase
      .from('url_templates')
      .delete()
      .eq('name', name);

    if (error) {
      console.error('템플릿 삭제 오류:', error);
      return NextResponse.json(
        { error: '템플릿 삭제에 실패했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '템플릿이 삭제되었습니다.'
    });

  } catch (error) {
    console.error('템플릿 삭제 오류:', error);
    return NextResponse.json(
      { error: '템플릿 삭제에 실패했습니다.' },
      { status: 500 }
    );
  }
}
