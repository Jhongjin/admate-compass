import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 환경 변수 확인 및 조건부 클라이언트 생성
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: any = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

export async function POST(request: NextRequest) {
  try {
    // Supabase 클라이언트 확인
    if (!supabase) {
      return NextResponse.json(
        { error: '데이터베이스 연결이 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const { action } = await request.json();
    
    if (action === 'add-size-column') {
      console.log('Adding size column to documents table...');
      
      // Check if size column already exists
      const { data: columns, error: columnError } = await supabase
        .from('information_schema.columns')
        .select('column_name')
        .eq('table_name', 'documents')
        .eq('column_name', 'size');
      
      if (columnError) {
        console.error('Error checking columns:', columnError);
        return NextResponse.json(
          { error: 'Failed to check columns', details: columnError.message },
          { status: 500 }
        );
      }
      
      if (columns && columns.length === 0) {
        // Size column doesn't exist, we need to add it
        // Since we can't use ALTER TABLE directly, we'll create a new table and migrate data
        console.log('Size column does not exist. This requires manual database migration.');
        return NextResponse.json(
          { 
            error: 'Size column does not exist. Please run the following SQL manually in Supabase:',
            sql: `
              ALTER TABLE documents ADD COLUMN size BIGINT DEFAULT 0;
              UPDATE documents SET size = 0 WHERE size IS NULL;
              ALTER TABLE documents ALTER COLUMN size SET NOT NULL;
            `
          },
          { status: 400 }
        );
      } else {
        console.log('Size column already exists');
        return NextResponse.json({
          success: true,
          message: 'Size column already exists in documents table'
        });
      }
      
      console.log('Size column added successfully');
      
      return NextResponse.json({
        success: true,
        message: 'Size column added to documents table successfully'
      });
    }
    
    return NextResponse.json(
      { error: 'Unknown action' },
      { status: 400 }
    );
    
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: 'Migration failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}