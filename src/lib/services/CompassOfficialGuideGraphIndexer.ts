import { createCompassServiceClient } from '@/lib/supabase/compass';
import type { DocumentChunk } from './TextChunkingService';
import type { VendorIntent } from './RAGSearchService';

type OfficialClaimType =
  | 'definition'
  | 'requirement'
  | 'prohibition'
  | 'allowance'
  | 'limit'
  | 'procedure'
  | 'asset_spec'
  | 'setup_step';

export interface OfficialGuideGraphIndexInput {
  documentId: string;
  title: string;
  url?: string | null;
  chunks: DocumentChunk[];
  metadata?: Record<string, any> | null;
  sourceType: 'url' | 'file';
}

export interface OfficialGuideGraphIndexResult {
  status: 'completed' | 'skipped' | 'failed';
  attempted: number;
  inserted: number;
  skipped: number;
  reason?: string;
}

interface OfficialGuideAssertionRow {
  source_kind: 'official_doc';
  source_document_id: string;
  source_chunk_id: string;
  claim_text: string;
  claim_type: OfficialClaimType;
  excerpt: string;
  source_url: string | null;
  vendor: VendorIntent;
  evidence_decision: 'verified' | 'weak';
  confidence: number;
  review_status: 'approved' | 'candidate';
  metadata: Record<string, any>;
}

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);
const MAX_ASSERTIONS_PER_DOCUMENT = 160;
const MIN_OFFICIAL_CHUNK_LENGTH = 140;
const GRAPH_INDEXER_VERSION = 'compass-official-guide-graph-v1';

const VENDOR_TERMS: Record<VendorIntent, string[]> = {
  META: ['meta', 'facebook', 'instagram', '페이스북', '인스타그램', '메타'],
  GOOGLE: ['google', 'youtube', '구글', '유튜브', 'gdn', 'google ads'],
  NAVER: ['naver', '네이버', 'searchad', '쇼핑검색', '사이트검색', '파워링크', '브랜드검색'],
  KAKAO: ['kakao', '카카오', '카카오톡', '비즈보드', '모먼트', 'kakao business'],
};

const OFFICIAL_HOSTS: Record<VendorIntent, string[]> = {
  META: [
    'facebook.com',
    'business.facebook.com',
    'developers.facebook.com',
    'help.instagram.com',
    'business.instagram.com',
    'metaforbusiness.com',
  ],
  GOOGLE: [
    'support.google.com',
    'ads.google.com',
    'developers.google.com',
    'business.google.com',
  ],
  NAVER: [
    'searchad.naver.com',
    'saedu.naver.com',
    'help.naver.com',
    'business.naver.com',
    'shopping.naver.com',
  ],
  KAKAO: [
    'business.kakao.com',
    'kakaobusiness.gitbook.io',
    'kakaoadfit.com',
  ],
};

const CLAIM_TYPE_PATTERNS: Array<[OfficialClaimType, RegExp]> = [
  ['setup_step', /sdk|mmp|픽셀|pixel|연동|설치|connect|연결|conversion(?:s)? api|앱\s*(등록|설치|인스톨)|카탈로그|catalog/i],
  ['procedure', /절차|단계|방법|등록|생성|설정|세팅|만들|추가|신청|검토 요청|심사 요청|업로드|집행|운영|process|setup|create|submit/i],
  ['asset_spec', /소재|이미지|동영상|영상|카루셀|슬라이드|배너|사이즈|크기|해상도|비율|픽셀|파일|jpg|jpeg|png|mp4|mov|avi|creative|asset/i],
  ['prohibition', /금지|불가|제한|반려|거부|위반|허용되지|사용할 수 없|제재|차단|prohibit|not allowed|disallow/i],
  ['limit', /최대|최소|이하|이상|미만|초과|제한|한도|\d+\s*(자|초|분|mb|gb|kb|px|픽셀|%|개)|limit|maximum|minimum/i],
  ['requirement', /필수|필요|해야|하여야|준수|확인해야|요구|조건|기준|required|must|need/i],
  ['allowance', /가능|허용|지원|사용할 수 있|allowed|available|support/i],
];

const TOPIC_PATTERNS: Array<[string, RegExp]> = [
  ['campaign_objective', /캠페인\s*목표|광고\s*관리자\s*목표|objective|인지도|트래픽|참여|잠재\s*고객|앱\s*홍보|판매/i],
  ['ad_format', /광고\s*형식|소재\s*형식|이미지|동영상|카루셀|슬라이드|컬렉션|쇼핑검색|비즈보드|display|video|carousel/i],
  ['placement', /노출\s*위치|게재\s*위치|지면|placements?|facebook|instagram|youtube|검색|디스플레이|쇼핑/i],
  ['procedure', /등록|설정|세팅|연동|생성|업로드|검토|심사|절차|단계|방법/i],
  ['review_policy', /정책|심사|승인|반려|금지|제한|업종|허위|과장|오인|주류|담배|청소년/i],
  ['commerce_measurement', /카탈로그|catalog|픽셀|pixel|sdk|mmp|db\s*url|상품\s*db|전환|conversion/i],
  ['asset_spec', /사이즈|크기|비율|해상도|파일|용량|초|mb|gb|px|픽셀/i],
];

export function isCompassOfficialGuideGraphIndexingEnabled(): boolean {
  const raw = process.env.COMPASS_OFFICIAL_GUIDE_GRAPH_INDEXING_ENABLED
    ?? process.env.COMPASS_EVIDENCE_GRAPH_ENABLED
    ?? '';

  return ENABLED_VALUES.has(String(raw).trim().toLowerCase());
}

export class CompassOfficialGuideGraphIndexer {
  private readonly supabase = createCompassServiceClient();

  async indexOfficialGuideAssertions(input: OfficialGuideGraphIndexInput): Promise<OfficialGuideGraphIndexResult> {
    if (!isCompassOfficialGuideGraphIndexingEnabled()) {
      return { status: 'skipped', attempted: 0, inserted: 0, skipped: input.chunks.length, reason: 'disabled' };
    }

    const vendor = this.inferVendor(input);
    if (!vendor) {
      return { status: 'skipped', attempted: 0, inserted: 0, skipped: input.chunks.length, reason: 'unknown_vendor' };
    }

    const isOfficial = this.isOfficialSource(vendor, input.url);
    if (!isOfficial && input.sourceType !== 'url') {
      return { status: 'skipped', attempted: 0, inserted: 0, skipped: input.chunks.length, reason: 'unverified_file_source' };
    }

    const rows = this.buildAssertionRows(input, vendor, isOfficial).slice(0, MAX_ASSERTIONS_PER_DOCUMENT);
    if (rows.length === 0) {
      return { status: 'skipped', attempted: 0, inserted: 0, skipped: input.chunks.length, reason: 'no_indexable_assertions' };
    }

    try {
      await this.staleExistingAssertions(input.documentId);

      let inserted = 0;
      for (const batch of this.batch(rows, 50)) {
        const { error } = await this.supabase
          .from('evidence_assertions')
          .insert(batch);

        if (error) {
          throw new Error(error.message);
        }

        inserted += batch.length;
      }

      console.log('🕸️ Official guide graph assertions indexed:', {
        documentId: input.documentId,
        vendor,
        attempted: rows.length,
        inserted,
      });

      return {
        status: 'completed',
        attempted: rows.length,
        inserted,
        skipped: Math.max(input.chunks.length - rows.length, 0),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('Official guide graph indexing skipped:', message);
      return {
        status: 'failed',
        attempted: rows.length,
        inserted: 0,
        skipped: input.chunks.length,
        reason: message,
      };
    }
  }

  private async staleExistingAssertions(documentId: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from('evidence_assertions')
      .update({
        review_status: 'stale',
        valid_to: now,
        updated_at: now,
      })
      .eq('source_kind', 'official_doc')
      .eq('source_document_id', documentId)
      .neq('review_status', 'stale');

    if (error) {
      throw new Error(error.message);
    }
  }

  private buildAssertionRows(
    input: OfficialGuideGraphIndexInput,
    vendor: VendorIntent,
    isOfficial: boolean,
  ): OfficialGuideAssertionRow[] {
    return input.chunks
      .filter((chunk) => this.isIndexableChunk(chunk))
      .map((chunk) => {
        const claimType = this.classifyClaimType(chunk.content);
        const graphTopics = this.extractGraphTopics(chunk.content);
        const graphPath = this.buildGraphPath(vendor, claimType, graphTopics);
        const chunkIndex = chunk.metadata?.chunkIndex ?? 0;
        const sourceUrl = input.url || chunk.metadata?.sourceUrl || null;
        const sourceChunkId = this.resolveSourceChunkId(input.documentId, chunk, chunkIndex);

        return {
          source_kind: 'official_doc',
          source_document_id: input.documentId,
          source_chunk_id: sourceChunkId,
          claim_text: this.buildClaimText(input.title, chunk.content, claimType, graphTopics),
          claim_type: claimType,
          excerpt: this.trimText(chunk.content, 1100),
          source_url: sourceUrl,
          vendor,
          evidence_decision: isOfficial ? 'verified' : 'weak',
          confidence: isOfficial ? this.confidenceForChunk(chunk, claimType) : 0.72,
          review_status: isOfficial ? 'approved' : 'candidate',
          metadata: {
            ...(input.metadata || {}),
            title: input.title,
            documentTitle: input.title,
            source_title: input.title,
            url: sourceUrl,
            document_url: sourceUrl,
            source_url: sourceUrl,
            source_kind: 'official_doc',
            vendor,
            claimType,
            graphPath,
            graphTopics,
            chunkIndex,
            sourceChunkId,
            sourceRowId: chunk.metadata?.sourceRowId ?? null,
            sourceCorpus: chunk.metadata?.sourceCorpus ?? null,
            chunkSignalScore: chunk.metadata?.signalScore ?? null,
            chunkingStrategy: chunk.metadata?.chunkingStrategy ?? null,
            officialGuideGraphIndexer: GRAPH_INDEXER_VERSION,
            reviewGate: isOfficial ? 'official_host_verified' : 'candidate_source',
          },
        };
      });
  }

  private resolveSourceChunkId(documentId: string, chunk: DocumentChunk, chunkIndex: number): string {
    const metadata = chunk.metadata as Record<string, any>;
    const explicitChunkId = metadata.sourceChunkId
      ?? metadata.source_chunk_id
      ?? metadata.chunkId
      ?? metadata.chunk_id;

    return String(explicitChunkId || `${documentId}_chunk_${chunkIndex}`);
  }

  private isIndexableChunk(chunk: DocumentChunk): boolean {
    const content = this.normalizeWhitespace(chunk.content);
    if (content.length < MIN_OFFICIAL_CHUNK_LENGTH) {
      return false;
    }

    if (/URL crawling is not available|서버리스 환경에서 크롤링할 수 없습니다|관리자가 별도로 처리/i.test(content)) {
      return false;
    }

    const signalScore = Number(chunk.metadata?.signalScore ?? 0);
    return signalScore >= 0.12
      || CLAIM_TYPE_PATTERNS.some(([, pattern]) => pattern.test(content))
      || TOPIC_PATTERNS.some(([, pattern]) => pattern.test(content));
  }

  private inferVendor(input: OfficialGuideGraphIndexInput): VendorIntent | null {
    const haystack = this.normalize(`${input.title} ${input.url || ''} ${input.metadata?.title || ''} ${input.metadata?.sourceTitle || ''}`);
    const contentSample = this.normalize(input.chunks.slice(0, 8).map((chunk) => chunk.content).join(' '));
    const combined = `${haystack} ${contentSample}`;

    for (const vendor of Object.keys(VENDOR_TERMS) as VendorIntent[]) {
      if (VENDOR_TERMS[vendor].some((term) => combined.includes(this.normalize(term)))) {
        return vendor;
      }
    }

    return null;
  }

  private isOfficialSource(vendor: VendorIntent, rawUrl?: string | null): boolean {
    if (!rawUrl) {
      return false;
    }

    try {
      const parsedUrl = new URL(rawUrl);
      const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
      const pathname = parsedUrl.pathname.toLowerCase();
      const hostMatches = OFFICIAL_HOSTS[vendor].some((host) => hostname === host || hostname.endsWith(`.${host}`));

      if (!hostMatches) {
        return false;
      }

      if (vendor === 'META' && hostname === 'facebook.com') {
        return /^\/(business|policies|help|privacy|legal)\b/.test(pathname);
      }

      return true;
    } catch {
      return false;
    }
  }

  private classifyClaimType(content: string): OfficialClaimType {
    for (const [claimType, pattern] of CLAIM_TYPE_PATTERNS) {
      if (pattern.test(content)) {
        return claimType;
      }
    }

    return 'definition';
  }

  private extractGraphTopics(content: string): string[] {
    const topics = TOPIC_PATTERNS
      .filter(([, pattern]) => pattern.test(content))
      .map(([topic]) => topic);

    return Array.from(new Set(topics.length > 0 ? topics : ['official_guide']));
  }

  private buildGraphPath(vendor: VendorIntent, claimType: OfficialClaimType, graphTopics: string[]): string {
    return [vendor, 'official_doc', ...graphTopics.slice(0, 2), claimType].join(' > ');
  }

  private buildClaimText(
    title: string,
    content: string,
    claimType: OfficialClaimType,
    graphTopics: string[],
  ): string {
    const heading = this.extractHeading(content) || title;
    const sentences = this.extractUsefulSentences(content);
    const topicText = graphTopics.map((topic) => this.topicLabel(topic)).join(' / ');
    const base = `${title} | ${topicText} | ${this.claimTypeLabel(claimType)}: ${heading}. ${sentences.join(' ')}`;
    return this.trimText(this.normalizeWhitespace(base), 520);
  }

  private extractHeading(content: string): string | null {
    const lines = content
      .split(/\r?\n/)
      .map((line) => this.normalizeWhitespace(line.replace(/^#+\s*/, '').replace(/^[*-]\s*/, '')))
      .filter(Boolean);

    return lines.find((line) => line.length >= 4 && line.length <= 90) || null;
  }

  private extractUsefulSentences(content: string): string[] {
    const sentences = this.normalizeWhitespace(content)
      .split(/(?<=[.!?。]|다\.|요\.|함\.|됨\.)\s+|[\r\n]+/)
      .map((sentence) => this.normalizeWhitespace(sentence))
      .filter((sentence) => sentence.length >= 18 && sentence.length <= 260);

    const prioritized = sentences.filter((sentence) => (
      CLAIM_TYPE_PATTERNS.some(([, pattern]) => pattern.test(sentence))
      || TOPIC_PATTERNS.some(([, pattern]) => pattern.test(sentence))
    ));

    return (prioritized.length > 0 ? prioritized : sentences).slice(0, 3);
  }

  private confidenceForChunk(chunk: DocumentChunk, claimType: OfficialClaimType): number {
    const signalScore = Math.max(0, Math.min(1, Number(chunk.metadata?.signalScore ?? 0.5)));
    const claimBoost = claimType === 'definition' ? 0.03 : 0.07;
    return Math.max(0.82, Math.min(0.97, 0.84 + signalScore * 0.08 + claimBoost));
  }

  private claimTypeLabel(claimType: OfficialClaimType): string {
    const labels: Record<OfficialClaimType, string> = {
      definition: '개념 설명',
      requirement: '필수 조건',
      prohibition: '제한/금지',
      allowance: '허용/지원',
      limit: '수치 제한',
      procedure: '운영 절차',
      asset_spec: '소재 사양',
      setup_step: '연동/설정',
    };

    return labels[claimType];
  }

  private topicLabel(topic: string): string {
    const labels: Record<string, string> = {
      campaign_objective: '캠페인 목표',
      ad_format: '광고 형식',
      placement: '노출 지면',
      procedure: '등록 절차',
      review_policy: '심사 기준',
      commerce_measurement: '커머스/측정',
      asset_spec: '소재 규격',
      official_guide: '공식 가이드',
    };

    return labels[topic] || topic;
  }

  private normalize(text: string): string {
    return this.normalizeWhitespace(text).toLowerCase();
  }

  private normalizeWhitespace(text: string): string {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  private trimText(text: string, maxLength: number): string {
    const normalized = this.normalizeWhitespace(text);
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength - 1).trim()}…`;
  }

  private batch<T>(items: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      batches.push(items.slice(index, index + size));
    }

    return batches;
  }
}

export const compassOfficialGuideGraphIndexer = new CompassOfficialGuideGraphIndexer();
