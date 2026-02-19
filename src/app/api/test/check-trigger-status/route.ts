import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 CASCADE 트리거 상태 확인 시작...');

    const supabaseAdmin = await createClient();

    // 1. 트리거 함수 존재 확인
    console.log('🔍 트리거 함수 존재 확인 중...');
    const { data: functions, error: functionError } = await supabaseAdmin
      .rpc('exec_sql', {
        sql: `
          SELECT 
            routine_name,
            routine_type,
            routine_definition
          FROM information_schema.routines 
          WHERE routine_name = 'cleanup_user_data_on_auth_delete'
          AND routine_schema = 'public';
        `
      });

    // 2. 트리거 존재 확인
    console.log('🔍 트리거 존재 확인 중...');
    const { data: triggers, error: triggerError } = await supabaseAdmin
      .rpc('exec_sql', {
        sql: `
          SELECT 
            trigger_name,
            event_manipulation,
            event_object_table,
            action_statement,
            action_timing
          FROM information_schema.triggers 
          WHERE trigger_name = 'on_auth_user_deleted'
          AND event_object_schema = 'auth';
        `
      });

    // 3. 외래키 제약조건 확인
    console.log('🔍 외래키 제약조건 확인 중...');
    const { data: constraints, error: constraintError } = await supabaseAdmin
      .rpc('exec_sql', {
        sql: `
          SELECT 
            tc.table_name, 
            kcu.column_name, 
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name,
            rc.delete_rule
          FROM 
            information_schema.table_constraints AS tc 
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
            JOIN information_schema.referential_constraints AS rc
                ON tc.constraint_name = rc.constraint_name
          WHERE constraint_type = 'FOREIGN KEY' 
            AND ccu.table_name = 'users'
            AND ccu.table_schema = 'auth';
        `
      });

    console.log('✅ CASCADE 트리거 상태 확인 완료');

    return NextResponse.json({
      success: true,
      message: 'CASCADE 트리거 상태 확인이 완료되었습니다.',
      data: {
        function_exists: !functionError && functions && functions.length > 0,
        function_error: functionError,
        function_data: functions,
        trigger_exists: !triggerError && triggers && triggers.length > 0,
        trigger_error: triggerError,
        trigger_data: triggers,
        constraints_exist: !constraintError && constraints && constraints.length > 0,
        constraint_error: constraintError,
        constraint_data: constraints,
        summary: {
          function_created: !functionError && functions && functions.length > 0,
          trigger_created: !triggerError && triggers && triggers.length > 0,
          cascade_constraints: !constraintError && constraints && constraints.length > 0,
        }
      }
    });

  } catch (error) {
    console.error('❌ CASCADE 트리거 상태 확인 중 오류 발생:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
