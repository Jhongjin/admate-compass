/**
 * RAG 데이터 정리를 위한 스크립트
 * 1. 보일러플레이트 제거
 * 2. 중복 제거 (제목 및 본문 기준)
 * 3. 저품질 데이터(너무 짧은 내용) 제거
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// .env.vercel에서 환경 변수 로드 시도
function loadEnv() {
    try {
        const envPath = path.resolve(process.cwd(), '.env.vercel');
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf-8');
            const lines = envContent.split('\n');
            for (const line of lines) {
                if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
                    process.env.NEXT_PUBLIC_SUPABASE_URL = line.split('=')[1].replace(/"/g, '').trim();
                }
                if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
                    process.env.SUPABASE_SERVICE_ROLE_KEY = line.split('=')[1].replace(/"/g, '').trim();
                }
            }
        }
    } catch (e) {
        console.error('환경 변수 로드 실패:', e);
    }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔗 Supabase URL:', supabaseUrl ? 'Set' : 'Not Set');
console.log('🔑 Supabase Key:', supabaseKey ? 'Set' : 'Not Set');

if (!supabaseUrl || !supabaseKey) {
    console.error('필요한 환경 변수가 없습니다: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 보일러플레이트 제거 로직 (src/lib/crawler-v2/utils/html-utils.ts의 로직 복제)
function stripBoilerplate(text: string): string {
    if (!text) return '';

    const boilerplatePatterns = [
        /^자세히 알아보기$/m,
        /^상품 더 알아보기$/m,
        /^더 알아보기$/m,
        /^카테고리 더보기$/m,
        /^목록보기$/m,
        /^전체보기$/m,
        /^문의하기$/m,
        /^의견 보내기$/m,
        /^도움이 되었나요\?$/m,
        /^위 내용으로 궁금한 점이 해결되지 않았나요$/m,
        /^\[목록\]$/m,
        /^맨 위로$/m,
        /^이전 페이지$/m,
        /^다음 페이지$/m
    ];

    let cleaned = text;
    for (const pattern of boilerplatePatterns) {
        cleaned = cleaned.replace(pattern, '');
    }

    return cleaned.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function cleanup() {
    const dryRun = process.argv.includes('--dry-run');
    console.log(`🚀 RAG 데이터 클린업 시작 (Dry run: ${dryRun})`);

    // 1. 모든 문서 가져오기
    const { data: documents, error } = await supabase
        .from('documents')
        .select('id, title, content');

    if (error) {
        console.error('문서 조회 실패:', error);
        return;
    }

    console.log(`📊 전체 문서 개수: ${documents.length}`);

    const processedIds = new Set<string>();
    const contentMap = new Map<string, string>(); // contentHash -> id
    let cleanedCount = 0;
    let deletedShortCount = 0;
    let duplicatedCount = 0;

    for (const doc of documents) {
        const originalTitle = doc.title || '';
        const originalContent = doc.content || '';

        // 보일러플레이트 제거 및 정리
        const cleanTitle = stripBoilerplate(originalTitle);
        const cleanContent = stripBoilerplate(originalContent);

        // 100자 미만 문서 삭제 대상
        if (cleanContent.length < 100) {
            console.log(`🗑️ 삭제 (너무 짧음): [${doc.id}] ${cleanTitle.substring(0, 30)}... (${cleanContent.length}자)`);
            if (!dryRun) {
                await supabase.from('documents').delete().eq('id', doc.id);
            }
            deletedShortCount++;
            continue;
        }

        // 중복 체크 (내용의 해시 또는 단순 문자열 비교)
        const contentHash = cleanTitle + '|||' + cleanContent;
        if (contentMap.has(contentHash)) {
            console.log(`👯 중복 발견: [${doc.id}]가 [${contentMap.get(contentHash)}]와 중복됨. 삭제합니다.`);
            if (!dryRun) {
                await supabase.from('documents').delete().eq('id', doc.id);
            }
            duplicatedCount++;
            continue;
        }
        contentMap.set(contentHash, doc.id);

        // 제목/본문 변경된 경우 업데이트
        if (cleanTitle !== originalTitle || cleanContent !== originalContent) {
            console.log(`⚙️ 업데이트 (노이즈 제거): [${doc.id}] ${originalTitle} -> ${cleanTitle}`);
            if (!dryRun) {
                await supabase
                    .from('documents')
                    .update({
                        title: cleanTitle,
                        content: cleanContent,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', doc.id);
            }
            cleanedCount++;
        }
    }

    console.log('\n✨ 결과 리포트:');
    console.log(`- 정리된 문서: ${cleanedCount}`);
    console.log(`- 삭제된 문서 (너무 짧음): ${deletedShortCount}`);
    console.log(`- 삭제된 문서 (중복): ${duplicatedCount}`);
    console.log(`- 전체 처리 완료.`);
}

cleanup().catch(console.error);
