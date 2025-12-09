
import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createPureClient();

        // 1. 최근 생성된 문서 50개 조회
        const { data: documents, error: docError } = await supabase
            .from('documents')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (docError) {
            throw docError;
        }

        // 2. 최근 작업(Jobs) 조회
        const { data: jobs, error: jobError } = await supabase
            .from('jobs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);

        if (jobError) {
            throw jobError;
        }

        return NextResponse.json({
            success: true,
            timestamp: new Date().toISOString(),
            documents: documents.map(doc => ({
                id: doc.id,
                title: doc.title,
                url: doc.url,
                status: doc.status,
                chunk_count: doc.chunk_count,
                created_at: doc.created_at,
                source_vendor: doc.source_vendor
            })),
            jobs: jobs.map(job => ({
                id: job.id,
                type: job.type,
                status: job.status,
                created_at: job.created_at,
                result: job.result
            }))
        });

    } catch (error) {
        console.error('Backend Check Error:', error);
        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : JSON.stringify(error),
            env_check: {
                url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
                key: !!process.env.SUPABASE_SERVICE_ROLE_KEY
            }
        }, { status: 500 });
    }
}
