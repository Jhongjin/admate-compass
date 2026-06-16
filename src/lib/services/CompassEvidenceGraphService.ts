import type { QueryIntent, VendorIntent } from './RAGSearchService';

export type EvidenceGraphSourceKind = 'official_doc' | 'resolved_case';

export interface EvidenceGraphCandidate {
  id: string;
  claimText: string;
  claimType: string;
  sourceKind: EvidenceGraphSourceKind;
  sourceDocumentId?: string | null;
  sourceChunkId?: string | null;
  caseId?: string | null;
  excerpt?: string | null;
  sourceUrl?: string | null;
  vendor?: VendorIntent | 'UNKNOWN';
  confidence: number;
  title: string;
  graphPath: string;
  score: number;
  matchedTerms: string[];
  metadata: Record<string, any>;
}

interface EvidenceGraphRawAssertion {
  id: string;
  claim_text: string;
  claim_type: string;
  source_kind: EvidenceGraphSourceKind;
  source_document_id?: string | null;
  source_chunk_id?: string | null;
  case_id?: string | null;
  excerpt?: string | null;
  source_url?: string | null;
  vendor?: string | null;
  evidence_decision?: string | null;
  confidence?: number | null;
  review_status?: string | null;
  valid_to?: string | null;
  metadata?: Record<string, any> | null;
  created_at?: string | null;
}

interface ResolvedCaseRow {
  id: string;
  issue_summary?: string | null;
  resolution_summary?: string | null;
  resolution_status?: string | null;
  approved_for_retrieval?: boolean | null;
}

const GRAPH_ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

const OPERATIONAL_ISSUE_TERMS = [
  '오류',
  '에러',
  '안떠',
  '안 뜨',
  '반려',
  '승인',
  '연동',
  '집행',
  '세팅',
  '설정',
  '노출',
  '소진',
  '타겟',
  'sdk',
  'mmp',
  'tracking_specs',
  '카탈로그',
  '픽셀',
  'onbid',
  '문의',
];

const EVIDENCE_ASSERTION_SELECT = 'id,claim_text,claim_type,source_kind,source_document_id,source_chunk_id,case_id,excerpt,source_url,vendor,evidence_decision,confidence,review_status,valid_to,metadata,created_at';

export function isCompassEvidenceGraphEnabled(): boolean {
  return GRAPH_ENABLED_VALUES.has(normalizeGraphFlagValue(process.env.COMPASS_EVIDENCE_GRAPH_ENABLED));
}

function normalizeGraphFlagValue(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\\r|\\n|\r|\n/g, '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim()
    .toLowerCase();
}

export class CompassEvidenceGraphService {
  constructor(private readonly supabase: any) {}

  async searchCandidates(query: string, intent: QueryIntent, limit = 8): Promise<EvidenceGraphCandidate[]> {
    if (!isCompassEvidenceGraphEnabled() || !this.supabase) {
      return [];
    }

    const terms = this.buildQueryTerms(query, intent).slice(0, 16);
    if (terms.length === 0) {
      return [];
    }

    try {
      const rows = await this.fetchCandidateRows(query, terms, intent, limit);
      const resolvedCaseMap = await this.loadApprovedResolvedCases(rows);
      const candidates = rows
        .filter((row) => this.isUsableAssertion(row, resolvedCaseMap))
        .map((row) => this.toCandidate(row, terms, intent, resolvedCaseMap))
        .filter((candidate): candidate is EvidenceGraphCandidate => Boolean(candidate))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      if (candidates.length > 0) {
        console.log('🕸️ Compass evidence graph candidates:', candidates.map((candidate) => ({
          id: candidate.id,
          sourceKind: candidate.sourceKind,
          vendor: candidate.vendor,
          score: candidate.score,
          matchedTerms: candidate.matchedTerms,
        })));
      }

      return candidates;
    } catch (error) {
      console.warn('Compass evidence graph search failed:', error);
      return [];
    }
  }

  private async fetchCandidateRows(
    query: string,
    terms: string[],
    intent: QueryIntent,
    limit: number,
  ): Promise<EvidenceGraphRawAssertion[]> {
    const structuredRows = await this.fetchStructuredRows(intent, limit);

    if (structuredRows.length > 0) {
      return structuredRows;
    }

    return this.fetchTextRows(query, terms, limit);
  }

  private async fetchStructuredRows(intent: QueryIntent, limit: number): Promise<EvidenceGraphRawAssertion[]> {
    if (intent.vendors.length === 0) {
      return [];
    }

    const vendors = intent.vendors;
    const sourceKinds = this.preferredSourceKinds(intent);
    const topics = this.preferredGraphTopics(intent).slice(0, 5);
    const claimTypes = this.preferredClaimTypes(intent).slice(0, 8);
    const perQueryLimit = Math.max(limit * 10, 40);
    const requests: Promise<{ data: EvidenceGraphRawAssertion[] | null; error: any }>[] = [];

    for (const vendor of vendors) {
      for (const sourceKind of sourceKinds) {
        for (const topic of topics) {
          requests.push(
            this.baseAssertionQuery()
              .eq('vendor', vendor)
              .eq('source_kind', sourceKind)
              .contains('metadata', { graphTopics: [topic] })
              .limit(perQueryLimit)
          );
        }

        if (claimTypes.length > 0) {
          requests.push(
            this.baseAssertionQuery()
              .eq('vendor', vendor)
              .eq('source_kind', sourceKind)
              .in('claim_type', claimTypes)
              .limit(perQueryLimit)
          );
        }

        requests.push(
          this.baseAssertionQuery()
            .eq('vendor', vendor)
            .eq('source_kind', sourceKind)
            .limit(Math.max(limit * 4, 16))
        );
      }
    }

    const results = await Promise.all(requests);
    const rows: EvidenceGraphRawAssertion[] = [];

    for (const result of results) {
      if (result.error) {
        console.warn('Compass evidence graph structured search branch skipped:', result.error.message);
        continue;
      }
      rows.push(...((result.data || []) as EvidenceGraphRawAssertion[]));
    }

    return this.dedupeRows(rows).slice(0, Math.max(limit * 24, 120));
  }

  private async fetchTextRows(
    query: string,
    terms: string[],
    limit: number,
  ): Promise<EvidenceGraphRawAssertion[]> {
    const focusedTerms = terms
      .filter((term) => !this.isWeakSearchTerm(term))
      .slice(0, 8);

    if (focusedTerms.length === 0) {
      return [];
    }

    const orFilter = focusedTerms
      .flatMap((term) => [
        `claim_text.ilike.%${term}%`,
        `excerpt.ilike.%${term}%`,
      ])
      .join(',');

    const { data, error } = await this.baseAssertionQuery()
      .or(orFilter)
      .limit(Math.max(limit * 5, 20));

    if (error) {
      console.warn('Compass evidence graph text search skipped:', error.message, {
        queryPreview: query.slice(0, 80),
        focusedTerms,
      });
      return [];
    }

    return (data || []) as EvidenceGraphRawAssertion[];
  }

  private baseAssertionQuery() {
    return this.supabase
      .from('evidence_assertions')
      .select(EVIDENCE_ASSERTION_SELECT)
      .eq('evidence_decision', 'verified')
      .eq('review_status', 'approved');
  }

  private preferredSourceKinds(intent: QueryIntent): EvidenceGraphSourceKind[] {
    const terms = [
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
      ...intent.adPolicyTerms,
    ];

    return this.isOperationalIssueQuery(terms)
      ? ['resolved_case', 'official_doc']
      : ['official_doc'];
  }

  private preferredGraphTopics(intent: QueryIntent): string[] {
    const topics: string[] = [];
    const add = (...values: string[]) => {
      for (const value of values) {
        if (!topics.includes(value)) topics.push(value);
      }
    };

    if (intent.topics.includes('product_structure') || intent.isProductStructureOverview) {
      add('campaign_objective', 'ad_format', 'placement', 'commerce_measurement', 'procedure', 'asset_spec');
    }

    if (intent.isSpecificProductGuidance) {
      add('procedure', 'asset_spec', 'ad_format', 'placement', 'commerce_measurement');
    }

    if (intent.topics.includes('spec')) {
      add('asset_spec', 'ad_format', 'placement');
    }

    if (intent.topics.includes('review') || intent.adPolicyTerms.length > 0) {
      add('review_policy', 'asset_spec', 'procedure', 'official_guide');
    }

    const commerceContext = [
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
      ...intent.keywords,
    ].join(' ').toLowerCase();
    if (/catalog|카탈로그|pixel|픽셀|sdk|mmp|db\s*url|상품\s*db|전환|conversion|앱|app|install|인스톨/.test(commerceContext)) {
      add('commerce_measurement', 'procedure', 'campaign_objective');
    }

    add(...intent.topics.map((topic) => {
      if (topic === 'product_structure') return 'campaign_objective';
      if (topic === 'review') return 'review_policy';
      if (topic === 'spec') return 'asset_spec';
      return topic;
    }));

    if (topics.length === 0) {
      add('official_guide', 'procedure', 'review_policy');
    }

    return topics;
  }

  private preferredClaimTypes(intent: QueryIntent): string[] {
    const claimTypes: string[] = [];
    const add = (...values: string[]) => {
      for (const value of values) {
        if (!claimTypes.includes(value)) claimTypes.push(value);
      }
    };

    if (intent.topics.includes('product_structure') || intent.isProductStructureOverview) {
      add('definition', 'procedure', 'setup_step', 'asset_spec', 'requirement', 'allowance', 'limit');
    }

    if (intent.isSpecificProductGuidance) {
      add('procedure', 'setup_step', 'asset_spec', 'requirement', 'limit', 'definition');
    }

    if (intent.topics.includes('review') || intent.adPolicyTerms.length > 0) {
      add('prohibition', 'requirement', 'limit', 'allowance', 'procedure', 'setup_step');
    }

    if (intent.topics.includes('spec')) {
      add('asset_spec', 'limit', 'requirement', 'procedure');
    }

    if (claimTypes.length === 0) {
      add('definition', 'procedure', 'requirement', 'setup_step');
    }

    return claimTypes;
  }

  private isWeakSearchTerm(term: string): boolean {
    const normalized = this.normalize(term);
    return normalized.length < 2
      || ['광고', '상품', '가이드', '알려줘', '대해', '대한', '위한', '기준', '확인', '설명', '어떻게'].includes(normalized);
  }

  private dedupeRows(rows: EvidenceGraphRawAssertion[]): EvidenceGraphRawAssertion[] {
    const seen = new Set<string>();
    const deduped: EvidenceGraphRawAssertion[] = [];

    for (const row of rows) {
      if (!row.id || seen.has(row.id)) {
        continue;
      }
      seen.add(row.id);
      deduped.push(row);
    }

    return deduped;
  }

  private async loadApprovedResolvedCases(rows: EvidenceGraphRawAssertion[]): Promise<Map<string, ResolvedCaseRow>> {
    const caseIds = Array.from(new Set(rows
      .filter((row) => row.source_kind === 'resolved_case' && row.case_id)
      .map((row) => row.case_id as string)));

    if (caseIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.supabase
      .from('resolved_cases')
      .select('id,issue_summary,resolution_summary,resolution_status,approved_for_retrieval')
      .in('id', caseIds);

    if (error) {
      console.warn('Compass evidence graph resolved case lookup skipped:', error.message);
      return new Map();
    }

    return new Map((data || []).map((row: ResolvedCaseRow) => [row.id, row]));
  }

  private isUsableAssertion(row: EvidenceGraphRawAssertion, resolvedCaseMap: Map<string, ResolvedCaseRow>): boolean {
    if (!row.claim_text?.trim()) {
      return false;
    }

    if (row.valid_to && new Date(row.valid_to).getTime() < Date.now()) {
      return false;
    }

    if (row.source_kind !== 'resolved_case') {
      return true;
    }

    const resolvedCase = row.case_id ? resolvedCaseMap.get(row.case_id) : null;
    return Boolean(resolvedCase?.approved_for_retrieval && resolvedCase.resolution_status === 'resolved');
  }

  private toCandidate(
    row: EvidenceGraphRawAssertion,
    terms: string[],
    intent: QueryIntent,
    resolvedCaseMap: Map<string, ResolvedCaseRow>,
  ): EvidenceGraphCandidate | null {
    const metadataSearchText = [
      row.metadata?.graphPath,
      Array.isArray(row.metadata?.graphTopics) ? row.metadata.graphTopics.join(' ') : '',
      row.metadata?.title,
      row.metadata?.documentTitle,
    ].filter(Boolean).join(' ');
    const visibleText = this.normalize([
      row.claim_text,
      row.excerpt,
      row.metadata?.title,
      row.metadata?.documentTitle,
      row.metadata?.source_title,
    ].filter(Boolean).join(' '));
    const text = this.normalize(`${visibleText} ${metadataSearchText}`);
    const sourceKind = row.source_kind;
    const topicMatches = Array.isArray(row.metadata?.graphTopics)
      ? row.metadata.graphTopics
        .filter((topic: unknown) => this.preferredGraphTopics(intent).includes(String(topic)))
        .map((topic: unknown) => String(topic))
      : [];
    const directTermMatches = terms.filter((term) => visibleText.includes(this.normalize(term)));
    const matchedTerms = Array.from(new Set([
      ...directTermMatches,
      ...topicMatches,
    ]));
    if (matchedTerms.length === 0 && intent.vendors.length === 0) {
      return null;
    }

    const resolvedCase = row.case_id ? resolvedCaseMap.get(row.case_id) : null;
    const vendor = this.normalizeVendor(row.vendor);
    if (
      sourceKind === 'official_doc'
      && intent.topics.includes('product_structure')
      && !this.isRelevantProductStructureOfficialGraph(visibleText, directTermMatches, intent)
    ) {
      return null;
    }

    const queryIsOperational = this.isOperationalIssueQuery(terms);
    const claimTypeBoost = this.claimTypeBoost(row.claim_type, queryIsOperational, intent, sourceKind);
    const sourceKindBoost = sourceKind === 'official_doc'
      ? (intent.topics.includes('product_structure') ? 0.24 : 0.18)
      : queryIsOperational
        ? 0.22
        : 0.04;
    const vendorBoost = vendor !== 'UNKNOWN' && intent.vendors.includes(vendor) ? 0.2 : 0;
    const matchRatio = matchedTerms.length / Math.max(terms.length, 1);
    const confidence = Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0.8;
    const score = Math.max(0, Math.min(1,
      0.24
      + matchRatio * 0.34
      + confidence * 0.16
      + sourceKindBoost
      + vendorBoost
      + claimTypeBoost
    ));

    const title = row.metadata?.title
      || row.metadata?.documentTitle
      || row.metadata?.source_title
      || (sourceKind === 'resolved_case' ? 'Compass 실무 해결 사례' : 'Compass 공식 가이드 근거');

    const graphPath = row.metadata?.graphPath || (sourceKind === 'resolved_case'
      ? `${vendor || 'UNKNOWN'} > resolved_case > ${row.claim_type}`
      : `${vendor || 'UNKNOWN'} > official_doc > ${row.claim_type}`);

    return {
      id: row.id,
      claimText: row.claim_text,
      claimType: row.claim_type,
      sourceKind,
      sourceDocumentId: row.source_document_id,
      sourceChunkId: row.source_chunk_id,
      caseId: row.case_id,
      excerpt: row.excerpt || resolvedCase?.resolution_summary || null,
      sourceUrl: row.source_url || row.metadata?.url || row.metadata?.document_url || null,
      vendor,
      confidence,
      title,
      graphPath,
      score,
      matchedTerms,
      metadata: {
        ...(row.metadata || {}),
        source_kind: sourceKind,
        graphPath,
        claimType: row.claim_type,
        resolvedCase,
      },
    };
  }

  private buildQueryTerms(query: string, intent: QueryIntent): string[] {
    const rawTerms = [
      ...query.split(/[\s,./|()[\]{}:;'"`~!?]+/),
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
      ...intent.adPolicyTerms,
      ...intent.vendors.flatMap((vendor) => this.vendorTerms(vendor)),
    ];

    return Array.from(new Set(rawTerms
      .map((term) => this.cleanTerm(term))
      .filter((term) => term.length >= 2)))
      .slice(0, 24);
  }

  private isRelevantProductStructureOfficialGraph(
    visibleText: string,
    directTermMatches: string[],
    intent: QueryIntent
  ): boolean {
    const queryText = this.normalize([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
    ].join(' '));
    const vendorTerms = new Set(intent.vendors.flatMap((vendor) => this.vendorTerms(vendor)).map((term) => this.normalize(term)));
    const meaningfulMatches = directTermMatches
      .map((term) => this.normalize(term))
      .filter((term) => term.length >= 2)
      .filter((term) => !vendorTerms.has(term))
      .filter((term) => !['광고', 'ads', '가이드', '정책', '기준', '정보', '문서', '알려줘', '대해'].includes(term));
    const hasProductSignal = this.hasProductStructureEvidenceSignal(visibleText);
    const hasMeaningfulProductOverlap = meaningfulMatches.some((term) => (
      /캠페인|목표|유형|형식|소재|노출|지면|게재|검색|디스플레이|쇼핑|앱|인스톨|설치|홍보|리드|비즈보드|상품|db|url|카탈로그|픽셀|전환|catalog|campaign|objective|format|placement|app|shopping|search|display|lead/.test(term)
    ));

    if (this.isOffAxisProductStructureEvidence(visibleText, queryText)) {
      return false;
    }

    if (this.isLowValueProductStructureEvidence(visibleText, queryText) && !hasMeaningfulProductOverlap) {
      return false;
    }

    return hasProductSignal || hasMeaningfulProductOverlap;
  }

  private hasProductStructureEvidenceSignal(text: string): boolean {
    return /캠페인\s*(목표|유형)|광고\s*(형식|포맷|소재)|노출\s*(위치|지면)|게재\s*위치|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|쇼핑\s*광고|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|리드\s*양식|비즈보드|상품\s*db|db\s*url|쇼핑검색|쇼핑블록|상품가이드|상품\s*가이드|캠페인\s*목적|광고\s*관리자\s*목표|campaign|objective|ad\s*format|placement|catalog|app\s*(install|promotion)/.test(text);
  }

  private isLowValueProductStructureEvidence(text: string, queryText: string): boolean {
    if (/세금|청구|결제/.test(text) && !/세금|청구|결제|tax|billing|payment/.test(queryText)) return true;
    if (/woocommerce|google\s*태그|태그\s*설정|gtag|측정\s*태그/.test(text) && !/태그|측정|woocommerce|gtag/.test(queryText)) return true;
    if (/라이브\s*관리|라이브커머스|쇼핑\s*라이브|shopping\s*live/.test(text) && !/라이브|live/.test(queryText)) return true;
    if (/가입하기|회원\s*가입|계정\s*(생성|만들기)|비즈니스\s*계정/.test(text) && !/가입|계정|account/.test(queryText)) return true;
    return false;
  }

  private isOffAxisProductStructureEvidence(text: string, queryText: string): boolean {
    if (/데이터\s*분류|개인정보\s*보호/.test(text) && !/데이터|분류|개인정보|privacy|data|타겟|잠재고객|세그먼트|audience|segment/.test(queryText)) {
      return true;
    }
    if (/오프라인\s*전환|향상된\s*전환|전환\s*(api|최적화|측정|추적|가져오기)|conversion\s*api|conversions?\s*api|enhanced\s*conversions|offline\s*conversion|capi/.test(text)
      && !/전환|측정|conversion|capi|mmp|픽셀|sdk|오프라인|api/.test(queryText)
    ) {
      return true;
    }
    if (/라이브\s*관리|라이브커머스|쇼핑\s*라이브|shopping\s*live/.test(text) && !/라이브|live/.test(queryText)) {
      return true;
    }
    if (/가입하기|회원\s*가입|계정\s*(생성|만들기)|비즈니스\s*계정/.test(text) && !/가입|계정|account/.test(queryText)) {
      return true;
    }
    return false;
  }

  private cleanTerm(term: string): string {
    return String(term || '')
      .replace(/[%,()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalize(text: string): string {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private normalizeVendor(value: unknown): VendorIntent | 'UNKNOWN' {
    const text = this.normalize(String(value || ''));
    if (['meta', 'facebook', 'instagram', '페이스북', '인스타그램', '메타'].includes(text)) return 'META';
    if (['kakao', '카카오', '카카오톡', '카카오모먼트', '카카오비즈니스', '비즈보드', '상품가이드', '상품 가이드'].includes(text)) return 'KAKAO';
    if (['naver', '네이버'].includes(text)) return 'NAVER';
    if (['google', 'youtube', '구글', '유튜브'].includes(text)) return 'GOOGLE';
    return 'UNKNOWN';
  }

  private vendorTerms(vendor: VendorIntent): string[] {
    if (vendor === 'META') return ['meta', 'facebook', 'instagram', '페이스북', '인스타그램', '메타'];
    if (vendor === 'KAKAO') return ['kakao', '카카오', '카카오톡', '비즈보드', '카카오모먼트', '카카오비즈니스', '상품가이드', '상품 가이드'];
    if (vendor === 'NAVER') return ['naver', '네이버', '검색광고', '쇼핑검색'];
    return ['google', '구글', 'youtube', '유튜브', 'gdn'];
  }

  private isOperationalIssueQuery(terms: string[]): boolean {
    const joined = this.normalize(terms.join(' '));
    return OPERATIONAL_ISSUE_TERMS.some((term) => joined.includes(this.normalize(term)));
  }

  private claimTypeBoost(
    claimType: string,
    queryIsOperational: boolean,
    intent: QueryIntent,
    sourceKind: EvidenceGraphSourceKind,
  ): number {
    if (queryIsOperational && ['resolved_issue', 'risk', 'setup_step', 'procedure'].includes(claimType)) {
      return 0.14;
    }

    if (sourceKind === 'official_doc' && intent.isSpecificProductGuidance && ['procedure', 'setup_step', 'asset_spec', 'requirement', 'limit'].includes(claimType)) {
      return 0.18;
    }

    if (sourceKind === 'official_doc' && intent.topics.includes('product_structure') && ['definition', 'procedure', 'setup_step', 'asset_spec', 'requirement', 'limit', 'allowance'].includes(claimType)) {
      return 0.14;
    }

    if (['procedure', 'setup_step', 'requirement', 'asset_spec'].includes(claimType)) {
      return 0.08;
    }

    return 0;
  }
}
