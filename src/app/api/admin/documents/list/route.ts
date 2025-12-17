import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const type = searchParams.get('type');

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: { persistSession: false },
                db: { schema: 'public' }
            }
        );

        let query = supabase
            .from('documents')
            .select('id, title, url, type, created_at')
            .order('created_at', { ascending: false });

        if (type) {
            query = query.eq('type', type);
        }

        // 삭제된 문서는 조회하지 않음 (hard delete이므로 실제로 삭제된 문서는 조회되지 않음)
        // 하지만 혹시 모를 경우를 대비해 명시적으로 필터링하지 않음
        // 삭제가 제대로 되었다면 자동으로 조회되지 않음
        
        const { data: documents, error } = await query;

        if (error) {
            console.error('Error fetching documents:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ documents });
    } catch (error) {
        console.error('Error in documents list API:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
