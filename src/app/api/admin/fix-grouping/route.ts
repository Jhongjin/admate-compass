import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * URL 정규화 함수 (비교용)
 */
function normalizeUrlForGrouping(url: string): string {
    if (!url) return '';
    return url.replace(/\/$/, "").trim().toLowerCase();
}

/**
 * URL이 부모 URL의 하위 페이지인지 확인
 */
function isSubPageUrl(childUrl: string, parentUrl: string): boolean {
    const normalizedChild = normalizeUrlForGrouping(childUrl);
    const normalizedParent = normalizeUrlForGrouping(parentUrl);
    
    if (normalizedChild === normalizedParent) return false;
    
    // 부모 URL이 자식 URL의 접두사인지 확인
    return normalizedChild.startsWith(normalizedParent + '/');
}

export async function GET(request: NextRequest) {
    try {
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: { persistSession: false },
                db: { schema: 'public' }
            }
        );

        console.log('🔧 문서 그룹화 복구 시작...');

        // 1. 모든 URL 문서 가져오기 (페이지네이션)
        let allDocs: any[] = [];
        let page = 0;
        const PAGE_SIZE = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabase
                .from('documents')
                .select('id, url, title, main_document_id, metadata, content')
                .eq('type', 'url')
                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

            if (error) throw error;

            if (data && data.length > 0) {
                allDocs = [...allDocs, ...data];
                if (data.length < PAGE_SIZE) hasMore = false;
                page++;
            } else {
                hasMore = false;
            }
        }

        console.log(`🔍 총 ${allDocs.length}개 문서 스캔 완료`);

        if (allDocs.length === 0) {
            return NextResponse.json({ success: true, message: 'No documents found' });
        }

        // 2. URL -> 문서 ID 맵 생성 (정규화된 URL 기준)
        const urlToDocMap = new Map<string, { id: string; url: string; title: string }>();
        allDocs.forEach(doc => {
            if (doc.url) {
                const normalized = normalizeUrlForGrouping(doc.url);
                if (!urlToDocMap.has(normalized)) {
                    urlToDocMap.set(normalized, {
                        id: doc.id,
                        url: doc.url,
                        title: doc.title || ''
                    });
                }
            }
        });

        // 3. 각 문서의 부모 찾기 및 복구 정보 생성
        const updates: Array<{
            id: string;
            main_document_id: string | null;
            metadata: any;
            title?: string;
        }> = [];

        let groupingFixed = 0;
        let titleFixed = 0;

        for (const doc of allDocs) {
            if (!doc.url) continue;

            const currentNormalized = normalizeUrlForGrouping(doc.url);
            let bestParent: { id: string; url: string } | null = null;
            let maxParentLength = 0;

            // 부모 URL 찾기 (URL 계층 구조 분석)
            for (const [normalizedUrl, parentInfo] of urlToDocMap.entries()) {
                if (normalizedUrl === currentNormalized) continue;

                if (isSubPageUrl(doc.url, parentInfo.url)) {
                    // 더 긴 부모 URL을 선택 (가장 가까운 부모)
                    if (normalizedUrl.length > maxParentLength) {
                        maxParentLength = normalizedUrl.length;
                        bestParent = { id: parentInfo.id, url: parentInfo.url };
                    }
                }
            }

            const update: any = {
                id: doc.id,
                main_document_id: null,
                metadata: doc.metadata || {}
            };

            // 그룹화 복구: main_document_id 설정
            if (bestParent) {
                // 현재 main_document_id가 잘못되었거나 없는 경우 복구
                if (doc.main_document_id !== bestParent.id) {
                    update.main_document_id = bestParent.id;
                    update.metadata.parentUrl = bestParent.url;
                    update.metadata.is_sub_page = true;
                    groupingFixed++;
                    console.log(`🔗 그룹화 복구: ${doc.url} -> 부모: ${bestParent.url}`);
                } else if (!update.metadata.parentUrl) {
                    // main_document_id는 맞지만 metadata가 없는 경우
                    update.metadata.parentUrl = bestParent.url;
                    update.metadata.is_sub_page = true;
                }
            } else {
                // 메인 페이지인 경우 main_document_id가 null이어야 함
                if (doc.main_document_id !== null) {
                    update.main_document_id = null;
                    delete update.metadata.parentUrl;
                    delete update.metadata.is_sub_page;
                    groupingFixed++;
                    console.log(`🔗 메인 페이지 복구: ${doc.url} (main_document_id 제거)`);
                }
            }

            // 제목 복구: "광고주센터" 같은 기본 제목인 경우 content에서 제목 추출 시도
            const defaultTitles = ['광고주센터', '도움말', 'Help', 'Advertiser Center', '광고주 센터', 'Advertiser'];
            const currentTitle = (doc.title || '').trim();
            
            if (defaultTitles.includes(currentTitle) && doc.content) {
                // content에서 제목 추출 시도 (Naver Ads FAQ 패턴)
                const titleMatch = doc.content.match(/<h[1-3][^>]*class="content_title"[^>]*>([^<]+)<\/h[1-3]>/i) ||
                                   doc.content.match(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/i) ||
                                   doc.content.match(/<title[^>]*>([^<]+)<\/title>/i);
                
                if (titleMatch && titleMatch[1]) {
                    const extractedTitle = titleMatch[1].trim();
                    if (extractedTitle && extractedTitle.length > 2 && !defaultTitles.includes(extractedTitle)) {
                        update.title = extractedTitle;
                        titleFixed++;
                        console.log(`📝 제목 복구: "${currentTitle}" -> "${extractedTitle}"`);
                    }
                }
            }

            // 업데이트가 필요한 경우만 추가
            if (update.main_document_id !== doc.main_document_id || 
                JSON.stringify(update.metadata) !== JSON.stringify(doc.metadata || {}) ||
                update.title) {
                updates.push(update);
            }
        }

        console.log(`📊 복구 요약: 그룹화 ${groupingFixed}개, 제목 ${titleFixed}개`);

        // 4. 배치 업데이트
        const BATCH_SIZE = 10;
        let updatedCount = 0;

        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = updates.slice(i, i + BATCH_SIZE);
            await Promise.all(
                batch.map(update => {
                    const updateData: any = {
                        main_document_id: update.main_document_id,
                        metadata: update.metadata,
                        updated_at: new Date().toISOString()
                    };
                    
                    if (update.title) {
                        updateData.title = update.title;
                    }

                    return supabase
                        .from('documents')
                        .update(updateData)
                        .eq('id', update.id);
                })
            );
            updatedCount += batch.length;
        }

        return NextResponse.json({
            success: true,
            message: `복구 완료: ${updatedCount}개 문서 업데이트 (그룹화: ${groupingFixed}개, 제목: ${titleFixed}개)`,
            stats: {
                totalScanned: allDocs.length,
                totalUpdated: updatedCount,
                groupingFixed,
                titleFixed
            },
            updated: updates.map(u => ({ id: u.id, url: urlToDocMap.get(normalizeUrlForGrouping(allDocs.find(d => d.id === u.id)?.url || ''))?.url || '' }))
        });

    } catch (error) {
        console.error('❌ 그룹화 복구 오류:', error);
        return NextResponse.json({ 
            success: false,
            error: error instanceof Error ? error.message : String(error) 
        }, { status: 500 });
    }
}
