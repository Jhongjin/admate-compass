import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // 🔥 무한대기 방지: 30분 이상 'processing' 상태로 멈춰있는 작업 조회 (기존 5분에서 증가)
        const thresholdTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();

        const { data: stuckJobs, error: fetchError } = await supabase
            .from('processing_jobs')
            .select('id, created_at, status, job_type')
            .eq('status', 'processing')
            .lt('created_at', thresholdTime);

        if (fetchError) {
            console.error('Error fetching stuck jobs:', fetchError);
            return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 });
        }

        if (!stuckJobs || stuckJobs.length === 0) {
            return NextResponse.json({ success: true, message: 'No stuck jobs found', count: 0 });
        }

        console.log(`Found ${stuckJobs.length} stuck jobs. Cleaning up...`);

        // 작업 삭제 (또는 failed로 업데이트)
        // 여기서는 완전히 삭제하여 UI에서 사라지게 함
        // 1. 오래된 processing 작업 정리 (기존 로직)
        const jobIds = stuckJobs.map(job => job.id);
        const { error: deleteError } = await supabase
            .from('processing_jobs')
            .delete()
            .in('id', jobIds);

        if (deleteError) {
            console.error('Error deleting stuck jobs:', deleteError);
        }

        // 2. [NEW] 고아 문서 정리 (status='processing'이지만 연결된 작업이 없는 문서)
        // 주의: 이 로직은 작업이 막 시작된 시점(job 생성 전)과 겹치지 않도록 주의해야 함.
        // 따라서 created_at이 일정 시간 지난 문서만 대상으로 함.
        // 🔥 무한대기 방지: 30분 이상 된 문서만 대상 (기존 5분에서 증가)
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

        const { data: stuckDocs, error: docError } = await supabase
            .from('documents')
            .select('id, chunk_count, status')
            .eq('status', 'processing')
            .lt('created_at', thirtyMinutesAgo);

        let fixedDocsCount = 0;

        if (!docError && stuckDocs && stuckDocs.length > 0) {
            console.log(`Found ${stuckDocs.length} potentially stuck documents.`);

            for (const doc of stuckDocs) {
                // 해당 문서에 대한 진행 중인 작업이 있는지 확인
                const { data: activeJob } = await supabase
                    .from('processing_jobs')
                    .select('id')
                    .eq('document_id', doc.id)
                    .in('status', ['queued', 'processing', 'retrying'])
                    .maybeSingle();

                if (!activeJob) {
                    // 작업이 없으면 고아 문서임. 상태 업데이트
                    const newStatus = doc.chunk_count > 0 ? 'indexed' : 'failed';
                    console.log(`Fixing orphaned document ${doc.id}: ${doc.status} -> ${newStatus}`);

                    await supabase
                        .from('documents')
                        .update({
                            status: newStatus,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', doc.id);

                    fixedDocsCount++;
                }
            }
        }

        return NextResponse.json({
            success: true,
            message: `Cleaned up ${stuckJobs.length} stuck jobs and ${fixedDocsCount} orphaned documents`,
            jobsCount: stuckJobs.length,
            docsCount: fixedDocsCount
        });

    } catch (error) {
        console.error('Cleanup API Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
