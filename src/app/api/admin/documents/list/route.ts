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
