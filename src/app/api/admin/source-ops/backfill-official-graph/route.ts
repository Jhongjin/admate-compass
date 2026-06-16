import { NextRequest, NextResponse } from 'next/server';
import { guardCompassProductAdminSessionRoute } from '@/lib/adminProductSessionGuard';
import { createCompassServiceClient } from '@/lib/supabase/compass';
import {
  compassOfficialGuideGraphIndexer,
  type OfficialGuideGraphIndexResult,
} from '@/lib/services/CompassOfficialGuideGraphIndexer';
import type { DocumentChunk } from '@/lib/services/TextChunkingService';
import type { VendorIntent } from '@/lib/services/RAGSearchService';

type SourceCorpus = 'document_chunks' | 'ollama_document_chunks';
type SourceSelection = SourceCorpus | 'both';

interface BackfillRequestBody {
  dryRun?: boolean;
  confirm?: string;
  source?: SourceSelection;
  limit?: number;
  documentId?: string;
  vendor?: VendorIntent;
}

interface DocumentRow {
  id: string;
  title: string;
  url?: string | null;
  type?: 'file' | 'url' | string | null;
  status?: string | null;
}

interface ChunkRow {
  id?: string | number | null;
  chunk_id?: string | number | null;
  content?: string | null;
  metadata?: Record<string, any> | null;
}

const MAX_BACKFILL_DOCUMENTS = 10;
const COMMIT_CONFIRMATION = 'index-official-graph';
const VENDOR_FILTER_TERMS: Record<VendorIntent, string[]> = {
  META: ['meta', 'facebook', 'instagram', '페이스북', '인스타그램', '메타'],
  GOOGLE: ['google', 'youtube', '구글', '유튜브', 'gdn'],
  NAVER: ['naver', '네이버', 'searchad', '쇼핑검색', '사이트검색', '브랜드검색'],
  KAKAO: ['kakao', '카카오', '비즈보드', '모먼트'],
};

export async function POST(request: NextRequest) {
  const sessionGuard = guardCompassProductAdminSessionRoute(request);
  if (sessionGuard) return sessionGuard;

  try {
    const body = await request.json().catch(() => ({})) as BackfillRequestBody;
    const dryRun = body.dryRun !== false;
    const source = normalizeSource(body.source);
    const limit = normalizeLimit(body.limit);

    if (!dryRun && body.confirm !== COMMIT_CONFIRMATION) {
      return NextResponse.json(
        {
          success: false,
          code: 'OFFICIAL_GRAPH_BACKFILL_CONFIRMATION_REQUIRED',
          error: '공식 가이드 그래프 백필 실행 확인값이 필요합니다.',
          message: `실제 반영은 confirm: "${COMMIT_CONFIRMATION}" 값을 함께 보내야 합니다. 기본 dryRun으로 먼저 대상 문서를 확인하세요.`,
        },
        { status: 409 },
      );
    }

    const supabase = createCompassServiceClient();
    const documents = await loadCandidateDocuments(supabase, {
      documentId: body.documentId,
      vendor: body.vendor,
      limit,
    });

    const results = [];
    for (const document of documents) {
      const sourceResult = await loadBestChunkSet(supabase, document.id, source);
      const chunks = sourceResult.chunks.map((chunk, index) => toDocumentChunk(chunk, document, sourceResult.source, index));

      let graphIndexResult: OfficialGuideGraphIndexResult | null = null;
      if (!dryRun && chunks.length > 0) {
        graphIndexResult = await compassOfficialGuideGraphIndexer.indexOfficialGuideAssertions({
          documentId: document.id,
          title: document.title,
          url: document.url,
          sourceType: document.type === 'url' ? 'url' : 'file',
          chunks,
          metadata: {
            graphBackfill: 'source-ops-official-guide-backfill-v1',
            backfillSourceCorpus: sourceResult.source,
            backfilledAt: new Date().toISOString(),
          },
        });
      }

      results.push({
        documentId: document.id,
        title: document.title,
        url: document.url,
        type: document.type,
        sourceCorpus: sourceResult.source,
        chunksRead: chunks.length,
        dryRun,
        graphIndexResult,
      });
    }

    return NextResponse.json({
      success: true,
      mode: dryRun ? 'dryRun' : 'commit',
      source,
      limit,
      documentsMatched: documents.length,
      results,
      nextAction: dryRun
        ? `문제 없으면 dryRun:false, confirm:"${COMMIT_CONFIRMATION}"로 작은 배치씩 실행하세요.`
        : '공식 가이드 그래프 근거 백필이 완료되었습니다.',
    });
  } catch (error) {
    console.error('Official guide graph backfill failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: '공식 가이드 그래프 백필에 실패했습니다.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

function normalizeSource(source: BackfillRequestBody['source']): SourceSelection {
  if (source === 'document_chunks' || source === 'ollama_document_chunks' || source === 'both') {
    return source;
  }

  return 'document_chunks';
}

function normalizeLimit(limit: unknown): number {
  const parsed = Number(limit || MAX_BACKFILL_DOCUMENTS);
  if (!Number.isFinite(parsed) || parsed <= 0) return MAX_BACKFILL_DOCUMENTS;

  return Math.min(Math.floor(parsed), MAX_BACKFILL_DOCUMENTS);
}

async function loadCandidateDocuments(
  supabase: ReturnType<typeof createCompassServiceClient>,
  options: { documentId?: string; vendor?: VendorIntent; limit: number },
): Promise<DocumentRow[]> {
  let query = supabase
    .from('documents')
    .select('id,title,url,type,status')
    .order('updated_at', { ascending: false })
    .limit(options.limit * 4);

  if (options.documentId) {
    query = query.eq('id', options.documentId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`문서 후보 조회 실패: ${error.message}`);
  }

  const documents = (data || []) as DocumentRow[];
  const filtered = options.vendor
    ? documents.filter((document) => matchesVendor(document, options.vendor as VendorIntent))
    : documents;

  return filtered.slice(0, options.limit);
}

async function loadBestChunkSet(
  supabase: ReturnType<typeof createCompassServiceClient>,
  documentId: string,
  source: SourceSelection,
): Promise<{ source: SourceCorpus; chunks: ChunkRow[] }> {
  const sources: SourceCorpus[] = source === 'both'
    ? ['document_chunks', 'ollama_document_chunks']
    : [source];

  for (const sourceCorpus of sources) {
    const { data, error } = await supabase
      .from(sourceCorpus)
      .select('id,chunk_id,content,metadata')
      .eq('document_id', documentId)
      .order('chunk_id', { ascending: true })
      .limit(500);

    if (error) {
      throw new Error(`${sourceCorpus} 청크 조회 실패: ${error.message}`);
    }

    const chunks = ((data || []) as ChunkRow[]).filter((chunk) => Boolean(chunk.content?.trim()));
    if (chunks.length > 0) {
      return { source: sourceCorpus, chunks };
    }
  }

  return { source: sources[0], chunks: [] };
}

function toDocumentChunk(
  row: ChunkRow,
  document: DocumentRow,
  sourceCorpus: SourceCorpus,
  index: number,
): DocumentChunk {
  const content = String(row.content || '');
  const metadata = row.metadata || {};
  const sourceChunkId = String(
    metadata.sourceChunkId
      ?? metadata.source_chunk_id
      ?? metadata.chunkId
      ?? metadata.chunk_id
      ?? row.chunk_id
      ?? `${document.id}_chunk_${index}`,
  );

  return {
    content,
    metadata: {
      chunkIndex: Number(metadata.chunkIndex ?? metadata.chunk_index ?? index),
      startChar: Number(metadata.startChar ?? metadata.start_char ?? 0),
      endChar: Number(metadata.endChar ?? metadata.end_char ?? content.length),
      chunkingStrategy: metadata.chunkingStrategy ?? metadata.chunking_strategy,
      contentLength: Number(metadata.contentLength ?? metadata.content_length ?? content.length),
      originalLength: Number(metadata.originalLength ?? metadata.original_length ?? content.length),
      signalScore: Number(metadata.signalScore ?? metadata.signal_score ?? 0.5),
      sourceTitle: metadata.sourceTitle ?? metadata.source_title ?? document.title,
      sourceUrl: metadata.sourceUrl ?? metadata.source_url ?? metadata.document_url ?? document.url ?? undefined,
      sourceChunkId,
      sourceRowId: row.id ?? null,
      sourceCorpus,
      chunkType: metadata.chunkType ?? metadata.chunk_type,
    },
  };
}

function matchesVendor(document: DocumentRow, vendor: VendorIntent): boolean {
  const text = `${document.title || ''} ${document.url || ''}`.toLowerCase();
  return VENDOR_FILTER_TERMS[vendor].some((term) => text.includes(term.toLowerCase()));
}
