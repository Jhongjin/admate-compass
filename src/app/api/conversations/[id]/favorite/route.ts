import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 환경 변수에서 설정 가져오기
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 빌드 시에는 환경 변수가 없을 수 있으므로 조건부 처리
let supabase: any = null;

if (supabaseUrl && supabaseServiceKey) {
  supabase = createClient(supabaseUrl, supabaseServiceKey);
}

// 즐겨찾기 토글 API
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: '서비스가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const { id } = params;
    const body = await request.json();
    const { is_favorite } = body;

    if (typeof is_favorite !== 'boolean') {
      return NextResponse.json(
        { error: 'is_favorite는 boolean 값이어야 합니다.' },
        { status: 400 }
      );
    }

    // conversations 테이블에 is_favorite 컬럼이 있는지 확인하고 업데이트
    const { data, error } = await supabase
      .from('conversations')
      .update({ is_favorite })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('즐겨찾기 업데이트 오류:', error);
      
      // 컬럼이 존재하지 않는 경우 성공으로 처리
      if (error.code === '42703' || error.message?.includes('column') && error.message?.includes('does not exist')) {
        console.warn('is_favorite 컬럼이 존재하지 않습니다. 즐겨찾기 기능을 건너뜁니다.');
        return NextResponse.json({
          success: true,
          message: 'is_favorite 컬럼이 아직 생성되지 않았습니다.'
        });
      }
      
      return NextResponse.json(
        { error: '즐겨찾기 상태를 업데이트하는 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      conversation: data
    });

  } catch (error) {
    console.error('즐겨찾기 토글 API 오류:', error);
    return NextResponse.json(
      { error: '즐겨찾기 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
