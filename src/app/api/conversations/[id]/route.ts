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

// 대화 삭제 API
export async function DELETE(
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

    // 대화 삭제
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('대화 삭제 오류:', error);
      
      // 테이블이 존재하지 않는 경우 성공으로 처리
      if (error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
        console.warn('conversations 테이블이 존재하지 않습니다. 삭제를 건너뜁니다.');
        return NextResponse.json({
          success: true,
          message: 'conversations 테이블이 아직 생성되지 않았습니다.'
        });
      }
      
      return NextResponse.json(
        { error: '대화를 삭제하는 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '대화가 삭제되었습니다.'
    });

  } catch (error) {
    console.error('대화 삭제 API 오류:', error);
    return NextResponse.json(
      { error: '대화 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
