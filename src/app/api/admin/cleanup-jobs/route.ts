import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // 1시간 이상 'processing' 상태로 멈춰있는 작업 조회
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        const { data: stuckJobs, error: fetchError } = await supabase
            .from('processing_jobs')
            .select('id, created_at, status, job_type')
            .eq('status', 'processing')
            .lt('created_at', oneHourAgo);

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
        const jobIds = stuckJobs.map(job => job.id);
        const { error: deleteError } = await supabase
            .from('processing_jobs')
            .delete()
            .in('id', jobIds);

        if (deleteError) {
            console.error('Error deleting stuck jobs:', deleteError);
            return NextResponse.json({ success: false, error: deleteError.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            message: `Successfully cleaned up ${stuckJobs.length} stuck jobs`,
            count: stuckJobs.length,
            jobs: stuckJobs
        });

    } catch (error) {
        console.error('Cleanup API Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
