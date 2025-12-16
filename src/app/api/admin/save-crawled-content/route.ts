/**
 * 크롤링된 콘텐츠 저장 API
 * URL 크롤링 결과를 Supabase에 저장
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ragProcessor } from '@/lib/services/RAGProcessor';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { results } = body;

    if (!results || !Array.isArray(results)) {
      return NextResponse.json(
        { error: '유효한 크롤링 결과가 필요합니다.' },
        { status: 400 }
      );
    }

    console.log('💾 크롤링 결과 저장 시작:', results.length, '개');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' }
      }
    );

    // --- 1. Identify Potential Parent Paths (Path Reduction) ---
    // Instead of loading ALL documents, we predict potential parents for the incoming batch.
    const candidatePaths = new Set<string>();

    // Also track "self" URLs to check for duplicates later in one go if needed, 
    // but the original logic checks duplicates one by one. We'll stick to that for safety.

    results.forEach(result => {
      if (!result.url) return;
      try {
        // Remove trailing slash for consistency
        const currentUrl = result.url.replace(/\/$/, "");
        const urlObj = new URL(currentUrl);
        const pathSegments = urlObj.pathname.split('/').filter(p => p.length > 0);

        // Generate all parent prefixes
        // e.g. /business/help/123 -> /business/help, /business
        let accumulatedPath = "";
        for (let i = 0; i < pathSegments.length - 1; i++) {
          accumulatedPath += "/" + pathSegments[i];
          // Construct full potential parent URL
          const candidateUrl = `${urlObj.origin}${accumulatedPath}`;

          // Add both versions (no-slash and with-slash) to candidates
          // because DB might store it either way
          candidatePaths.add(candidateUrl);
          candidatePaths.add(candidateUrl + '/');
        }
      } catch (e) {
        // Invalid URL, ignore
      }
    });

    const uniqueCandidates = Array.from(candidatePaths);
    const existingParentsMap = new Map<string, { url: string, id: string }>(); // normalized -> { url, id }

    // --- 2. Bulk Lookup Candidate Parents ---
    if (uniqueCandidates.length > 0) {
      // Query in batches if candidates are too many (Supabase 'in' limit ~65k chars usually, safely 100 items)
      // Let's do batches of 50
      const BATCH_SIZE = 50;
      for (let i = 0; i < uniqueCandidates.length; i += BATCH_SIZE) {
        const batch = uniqueCandidates.slice(i, i + BATCH_SIZE);
        const { data: foundParents, error } = await supabase
          .from('documents')
          .select('id, url')
          .in('url', batch)
          .eq('type', 'url');

        if (foundParents) {
          foundParents.forEach(p => {
            const norm = p.url.replace(/\/$/, "").trim();
            existingParentsMap.set(norm, { url: p.url, id: p.id });
          });
        }
      }
    }

    // Also add any URLs that are IN the current batch to the map, so they can parent each other
    // This is critical for grouping: if seed URL is in current batch, sub-pages can reference it
    const currentBatchMap = new Map<string, { url: string, id: string | null }>();
    results.forEach(r => {
      if (r.url) {
        const norm = r.url.replace(/\/$/, "").trim();
        // Add to current batch map (ID will be set when document is created)
        if (!currentBatchMap.has(norm)) {
          currentBatchMap.set(norm, { url: r.url, id: null });
        }
      }
    });
    
    console.log(`📦 Current batch URLs: ${currentBatchMap.size}개`);

    console.log(`🗺️ Parent Map Size: ${existingParentsMap.size}`);
    // Log a few entries for debugging
    let logCount = 0;
    for (const [k, v] of existingParentsMap.entries()) {
      if (logCount++ < 5) console.log(`  Map Entry: ${k} -> ${v.url} (${v.id})`);
    }

    // --- 3. Process Each Result ---

    const savedDocuments = [];
    const errors = [];

    for (const result of results) {
      try {
        if (result.status !== 'success' || !result.content) {
          continue;
        }

        // --- Backend Auto-Grouping Logic ---
        let metadata = result.metadata || {};
        let parentUrl = metadata.parentUrl || null;
        let mainDocumentId: string | undefined = undefined;

        // Try to resolve parent ID if parentUrl exists from frontend discovery
        if (parentUrl) {
          const normParent = parentUrl.replace(/\/$/, "").trim();
          
          // 1. First check existing DB parents
          let parentInfo = existingParentsMap.get(normParent);
          
          // 2. If not found, check current batch (for same-batch grouping)
          if (!parentInfo) {
            const batchParent = currentBatchMap.get(normParent);
            if (batchParent) {
              // Find the document ID from savedDocuments if already saved
              const savedParent = savedDocuments.find(s => {
                const savedNorm = s.url.replace(/\/$/, "").trim();
                return savedNorm === normParent;
              });
              if (savedParent) {
                parentInfo = { url: batchParent.url, id: savedParent.id };
              } else {
                // Parent will be saved later in this batch, we'll update main_document_id after
                parentInfo = { url: batchParent.url, id: null };
              }
            }
          }
          
          if (parentInfo && parentInfo.id) {
            mainDocumentId = parentInfo.id;
            // Ensure URL matches DB canonical
            parentUrl = parentInfo.url;
            metadata.parentUrl = parentInfo.url;
            console.log(`🔗 [Grouping] Parent found: ${parentUrl} (ID: ${mainDocumentId})`);
          } else if (parentInfo) {
            // Parent URL exists but ID not yet available (will be in same batch)
            parentUrl = parentInfo.url;
            metadata.parentUrl = parentInfo.url;
            console.log(`⏳ [Grouping] Parent URL found in batch but ID not yet available: ${parentUrl}`);
          }
        }

        if (!parentUrl) {
          // Try to find a parent in existing map
          const currentNormalized = result.url.replace(/\/$/, "").trim();
          let bestParentInfo = null;
          let maxLen = 0;

          console.log(`🔍 Doing Auto-Grouping for: ${currentNormalized}`);

          for (const [parentNormalized, info] of existingParentsMap.entries()) {
            // Check if current URL is a child of this parent
            if (currentNormalized !== parentNormalized && currentNormalized.startsWith(parentNormalized + '/')) {
              console.log(`   Candidate Match: ${parentNormalized}`);
              if (parentNormalized.length > maxLen) {
                maxLen = parentNormalized.length;
                bestParentInfo = info;
              }
            }
          }

          if (bestParentInfo && bestParentInfo.id) {
            console.log(`🔗 [Auto-Grouping] Found parent for ${result.url}: ${bestParentInfo.url} (ID: ${bestParentInfo.id})`);
            parentUrl = bestParentInfo.url;
            mainDocumentId = bestParentInfo.id;
            metadata = {
              ...metadata,
              parentUrl: bestParentInfo.url,
              is_sub_page: true
            };
          } else {
            console.log(`⚠️ [Auto-Grouping] No parent found for ${result.url}`);
          }
        }
        // --- End Auto-Grouping Logic ---

        // URL 중복 확인
        console.log(`🔍 URL 중복 확인: ${result.url}`);
        const { data: existingDocs, error: checkError } = await supabase
          .from('documents')
          .select('id, title, created_at, chunk_count')
          .eq('url', result.url)
          .eq('type', 'url');

        if (checkError) {
          console.error('❌ URL 중복 확인 오류:', checkError);
          continue;
        }

        let documentId: string;
        let isReindex = false;

        if (existingDocs && existingDocs.length > 0) {
          // 기존 URL 발견 - 재인덱싱
          console.log(`🔄 기존 URL 발견, 재인덱싱 시작: ${result.url}`);
          documentId = existingDocs[0].id;
          isReindex = true;

          // 기존 청크 및 임베딩 삭제
          const { error: deleteChunksError } = await supabase
            .from('document_chunks')
            .delete()
            .eq('document_id', documentId);

          if (deleteChunksError) {
            console.error('❌ 기존 청크 삭제 오류:', deleteChunksError);
            continue;
          }

          // 문서 상태를 'processing'으로 업데이트
          const { error: updateError } = await supabase
            .from('documents')
            .update({
              status: 'processing',
              chunk_count: 0,
              updated_at: new Date().toISOString(),
              // Update metadata for grouping logic
              source_vendor: result.vendor ? result.vendor.toUpperCase() : 'META',
              metadata: metadata
            })
            .eq('id', documentId);

          if (updateError) {
            console.error('❌ 문서 상태 업데이트 오류:', updateError);
            continue;
          }

          console.log(`✅ 기존 URL 재인덱싱 준비 완료: ${result.url}`);
        } else {
          // 새로운 URL - 새로 생성
          documentId = `url_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          console.log(`🆕 새로운 URL 생성: ${result.url}`);
        }

        console.log(`🔍 저장할 문서 데이터: title="${result.title}", url="${result.url}"`);

        // 벤더 정보 정규화 (대문자로 변환, 기본값: META)
        const normalizedVendor = result.vendor ? result.vendor.toUpperCase() : 'META';
        console.log('🏷️ 벤더 정보:', { original: result.vendor, normalized: normalizedVendor, url: result.url });

        const documentData = {
          id: documentId,
          title: result.title || result.url,
          content: result.content,
          type: 'url',
          file_size: 0,
          file_type: 'url',
          url: result.url,
          source_vendor: normalizedVendor, // 벤더 정보 추가
          metadata: metadata, // 메타데이터 추가 (부모 URL 등)
          main_document_id: mainDocumentId, // Foreign Key for Grouping
          created_at: isReindex ? existingDocs[0].created_at : new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        console.log(`💾 최종 저장 데이터: title="${documentData.title}", id="${documentData.id}"`);

        // RAG 처리 (중복 검사 없이 강제 처리)
        const ragResult = await ragProcessor.processDocument(documentData, false);

        if (ragResult.success) {
          savedDocuments.push({
            id: documentId,
            url: result.url,
            title: result.title,
            chunkCount: ragResult.chunkCount || 0,
            parentUrl: parentUrl || null,
            mainDocumentId: mainDocumentId || null
          });
          
          // Update current batch map with the saved document ID
          const normUrl = result.url.replace(/\/$/, "").trim();
          if (currentBatchMap.has(normUrl)) {
            currentBatchMap.set(normUrl, { url: result.url, id: documentId });
          }
          
          console.log('✅ URL 저장 완료:', result.url, {
            documentId,
            parentUrl: parentUrl || 'null',
            mainDocumentId: mainDocumentId || 'null'
          });
        } else {
          errors.push({
            url: result.url,
            error: 'RAG 처리 실패'
          });
        }

      } catch (error) {
        console.error('❌ URL 저장 실패:', result.url, error);
        errors.push({
          url: result.url,
          error: error instanceof Error ? error.message : '알 수 없는 오류'
        });
      }
    }

    // --- 4. Post-process: Update main_document_id for documents that reference parents in same batch ---
    console.log('🔄 같은 배치 내 parent 참조 업데이트 시작...');
    const urlToIdMap = new Map<string, string>();
    savedDocuments.forEach(doc => {
      if (doc.url) {
        const norm = doc.url.replace(/\/$/, "").trim();
        urlToIdMap.set(norm, doc.id);
      }
    });

    let updatedCount = 0;
    for (const savedDoc of savedDocuments) {
      if (savedDoc.parentUrl && !savedDoc.mainDocumentId) {
        const normParent = savedDoc.parentUrl.replace(/\/$/, "").trim();
        const parentId = urlToIdMap.get(normParent);
        
        if (parentId) {
          console.log(`🔗 같은 배치 내 parent 찾음: ${savedDoc.url} -> ${savedDoc.parentUrl} (ID: ${parentId})`);
          
          const { error: updateError } = await supabase
            .from('documents')
            .update({ main_document_id: parentId })
            .eq('id', savedDoc.id);
          
          if (updateError) {
            console.error(`❌ main_document_id 업데이트 실패: ${savedDoc.id}`, updateError);
          } else {
            updatedCount++;
            console.log(`✅ main_document_id 업데이트 완료: ${savedDoc.id} -> ${parentId}`);
          }
        }
      }
    }
    
    if (updatedCount > 0) {
      console.log(`✅ 총 ${updatedCount}개 문서의 main_document_id 업데이트 완료`);
    }

    return NextResponse.json({
      success: true,
      message: `${savedDocuments.length}개의 URL이 성공적으로 저장되었습니다.`,
      data: {
        savedDocuments,
        errors,
        summary: {
          total: results.length,
          success: savedDocuments.length,
          failed: errors.length,
          groupingUpdated: updatedCount
        }
      }
    });

  } catch (error) {
    console.error('❌ 크롤링 결과 저장 오류:', error);
    return NextResponse.json(
      {
        error: '크롤링 결과 저장 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류'
      },
      { status: 500 }
    );
  }
}
