
import { createPureClient } from '../src/lib/supabase/pure';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function cleanupDuplicates() {
    console.log('🚀 [CleanupDuplicates] 중복 URL 정리 작업 시작...');
    const supabase = await createPureClient();

    // 1. 모든 문서 조회 (URL 및 생성일 기준 정렬)
    const { data: allDocs, error: docError } = await supabase
        .from('documents')
        .select('id, url, created_at')
        .order('url', { ascending: true })
        .order('created_at', { ascending: false });

    if (docError) {
        console.error('❌ 문서 조회 실패:', docError);
        return;
    }

    const urlGroups = new Map<string, any[]>();
    allDocs.forEach(doc => {
        if (!urlGroups.has(doc.url)) {
            urlGroups.set(doc.url, []);
        }
        urlGroups.get(doc.url)!.push(doc);
    });

    const duplicateGroups = Array.from(urlGroups.entries())
        .filter(([url, group]) => group.length > 1);

    if (duplicateGroups.length === 0) {
        console.log('✅ 중복된 URL이 없습니다.');
        return;
    }

    const deleteIds: string[] = [];
    duplicateGroups.forEach(([url, group]) => {
        // group[0]은 최신 데이터이므로 유지, group[1:]은 삭제 대상
        const candidates = group.slice(1).map(d => d.id);
        deleteIds.push(...candidates);
    });

    console.log(`📊 중복 그룹: ${duplicateGroups.length}개 | 삭제 대상 문서: ${deleteIds.length}개`);

    if (deleteIds.length > 0) {
        console.log(`🗑️ 연관 데이터(Chunks, Metadata, Logs) 삭제 중...`);

        const { error: chunkErr } = await supabase.from('document_chunks').delete().in('document_id', deleteIds);
        if (chunkErr) console.error('⚠️ Chunks 삭제 오류:', chunkErr);

        const { error: metaErr } = await supabase.from('document_metadata').delete().in('document_id', deleteIds);
        if (metaErr) console.error('⚠️ Metadata 삭제 오류:', metaErr);

        const { error: logErr } = await supabase.from('document_logs').delete().in('document_id', deleteIds);
        if (logErr) console.error('⚠️ Logs 삭제 오류:', logErr);

        console.log(`🗑️ 최종 Documents 삭제 중...`);
        const { error: docDelErr } = await supabase.from('documents').delete().in('id', deleteIds);

        if (docDelErr) {
            console.error('❌ Documents 삭제 실패:', docDelErr);
        } else {
            console.log(`✅ 중복 문서 ${deleteIds.length}개 정리 완료!`);
        }
    }
}

cleanupDuplicates().catch(console.error);
