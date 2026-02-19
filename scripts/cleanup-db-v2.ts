/**
 * RAG 데이터 품질 개선을 위한 일괄 정제 스크립트 (V2)
 * 1. 강화된 보일러플레이트 제거 로직 적용
 * 2. 중복 타이틀/컨텐츠 기반 중복 제거
 * 3. 저품질(짧은 내용) 문서 필터링
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { stripBoilerplate } from '../src/lib/crawler-v2/utils/html-utils';

// 환경 변수 로드
function loadEnv() {
    try {
        const envFiles = ['.env.vercel', '.env.local', '.env'];
        for (const file of envFiles) {
            const envPath = path.resolve(process.cwd(), file);
            if (fs.existsSync(envPath)) {
                const envContent = fs.readFileSync(envPath, 'utf-8');
                const lines = envContent.split('\n');
                for (const line of lines) {
                    const [key, ...valueParts] = line.split('=');
                    if (key && valueParts.length > 0) {
                        const value = valueParts.join('=').replace(/"/g, '').trim();
                        if (key === 'NEXT_PUBLIC_SUPABASE_URL') process.env.NEXT_PUBLIC_SUPABASE_URL = value;
                        if (key === 'SUPABASE_SERVICE_ROLE_KEY') process.env.SUPABASE_SERVICE_ROLE_KEY = value;
                    }
                }
                console.log(`✅ ${file} 환경 변수 로드 완료`);
                break;
            }
        }
    } catch (e) {
        console.error('⚠️ 환경 변수 로드 중 오류:', e);
    }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ 필수 환경 변수가 없습니다 (URL 또는 Key)');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanupV2() {
    const dryRun = process.argv.includes('--dry-run');
    console.log(`\n🚀 [정제 V2] 데이터 클린업 시작 (Dry run: ${dryRun})`);

    // 1. 모든 문서 조회
    const { data: documents, error } = await supabase
        .from('documents')
        .select('id, title, content, url');

    if (error) {
        console.error('❌ 문서 조회 실패:', error);
        return;
    }

    console.log(`📊 전체 문서수: ${documents.length}건`);

    const contentSet = new Set<string>(); // 중복 체크용 (title + content 조합)
    let stats = {
        updated: 0,
        deletedShort: 0,
        deletedDuplicate: 0,
        unchanged: 0
    };

    for (const doc of documents) {
        const originalTitle = doc.title || '';
        const originalContent = doc.content || '';

        // 로직 개선사항 반영하여 정제
        const cleanTitle = stripBoilerplate(originalTitle);
        const cleanContent = stripBoilerplate(originalContent);

        // A. 너무 짧은 문서 (노이즈 제외 후 100자 미만)
        if (cleanContent.length < 100) {
            console.log(`🗑️ [삭제-저품질] ${doc.id} | 길이: ${cleanContent.length}자 | 제목: ${cleanTitle.substring(0, 20)}...`);
            if (!dryRun) {
                await supabase.from('documents').delete().eq('id', doc.id);
                // 연관된 청크도 삭제 (Cascade 설정이 안되어 있을 경우를 대비)
                await supabase.from('document_chunks').delete().eq('document_id', doc.id);
            }
            stats.deletedShort++;
            continue;
        }

        // B. 중복 데이터 (타이틀과 본문 내용이 동일한 경우)
        const combinedKey = `${cleanTitle}:::${cleanContent.substring(0, 500)}`; // 앞부분 500자만 비교
        if (contentSet.has(combinedKey)) {
            console.log(`👯 [삭제-중복] ${doc.id} | 제목: ${cleanTitle}`);
            if (!dryRun) {
                await supabase.from('documents').delete().eq('id', doc.id);
                await supabase.from('document_chunks').delete().eq('document_id', doc.id);
            }
            stats.deletedDuplicate++;
            continue;
        }
        contentSet.add(combinedKey);

        // C. 내용 수정이 필요한 경우 (보일러플레이트 제거 등)
        if (cleanTitle !== originalTitle || cleanContent !== originalContent) {
            console.log(`⚙️ [업데이트] ${doc.id} | "${originalTitle}" -> "${cleanTitle}"`);
            if (!dryRun) {
                await supabase
                    .from('documents')
                    .update({
                        title: cleanTitle,
                        content: cleanContent,
                        status: 'pending', // 임베딩 재생성을 위해 상태 변경
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', doc.id);
            }
            stats.updated++;
        } else {
            stats.unchanged++;
        }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ [정제 결과 리포트]');
    console.log(`- 업데이트 건수 (정제됨): ${stats.updated}건`);
    console.log(`- 삭제 건수 (저품질): ${stats.deletedShort}건`);
    console.log(`- 삭제 건수 (중복): ${stats.deletedDuplicate}건`);
    console.log(`- 유지된 건수: ${stats.unchanged}건`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

cleanupV2().catch(console.error);
