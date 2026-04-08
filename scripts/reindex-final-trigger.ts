
import { createPureClient } from '../src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function finalForceReindex() {
    console.log('🚀 [FinalReindex] 강제 재인덱싱 트리거 시작...');
    const supabase = await createPureClient();

    // 1. 대상 선정 (최근 pending으로 바꾼 27개 또는 status=failed였던 것)
    // 안전하게 다시 한번 status='failed'인 것 뿐만 아니라, 방금 pending으로 바꾼 것들도 포함하여 처리
    const { data: targetDocs } = await supabase
        .from('documents')
        .select('id, url, source_vendor')
        .or('status.eq.failed,status.eq.pending')
        .eq('chunk_count', 0); // 진행 안 된 것 위주 (또는 chunk_count IS NULL)

    // 추가로 NULL 체크
    const { data: nullDocs } = await supabase
        .from('documents')
        .select('id, url, source_vendor')
        .or('status.eq.failed,status.eq.pending')
        .is('chunk_count', null);

    const allTargets = [...(targetDocs || []), ...(nullDocs || [])];
    const uniqueIds = Array.from(new Set(allTargets.map(d => d.id)));
    const finalDocs = uniqueIds.map(id => allTargets.find(d => d.id === id)!);

    if (finalDocs.length === 0) {
        console.log('✅ 처리할 대상 문서가 없습니다.');
        return;
    }

    console.log(`📊 최종 대상 문서 수: ${finalDocs.length}개`);

    // 2. documents 상태를 모두 'pending'으로 확실히 고정
    await supabase.from('documents').update({ status: 'pending' }).in('id', uniqueIds);

    // 3. 기존 processing_jobs 삭제 (클린 업데이트를 위해)
    console.log('🗑️ 기존 관련 작업 삭제 중...');
    await supabase.from('processing_jobs').delete().in('document_id', uniqueIds);

    // 4. 신규 작업 INSERT
    console.log('📥 신규 크롤링 작업 등록 중...');
    const inserts = finalDocs.map(doc => ({
        document_id: doc.id,
        job_type: 'CRAWL',
        status: 'queued',
        priority: 10, // 우선순위 높임
        payload: {
            url: doc.url,
            vendor: doc.source_vendor || 'NAVER',
            options: { useCache: false },
            source: 'final_force_reindex'
        },
        scheduled_at: new Date().toISOString(),
        attempts: 0,
        max_attempts: 3
    }));

    const { error: insError } = await supabase.from('processing_jobs').insert(inserts);

    if (insError) {
        console.error('❌ 작업 등록 최종 실패:', insError);
    } else {
        console.log(`✅ ${inserts.length}개의 작업이 큐에 성공적으로 등록되었습니다.`);
    }

    // 5. 최종 카운트 확인
    const { count } = await supabase.from('processing_jobs').select('*', { count: 'exact', head: true }).eq('status', 'queued');
    console.log(`📊 현재 전체 Queued 작업 수: ${count}개`);
}

finalForceReindex().catch(console.error);
