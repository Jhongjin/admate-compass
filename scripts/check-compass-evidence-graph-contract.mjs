import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertIncludes(content, needle, label) {
  if (!content.includes(needle)) {
    throw new Error(`${label} missing: ${needle}`);
  }
}

const migration = read('supabase/migrations/20260616000000_create_compass_evidence_graph.sql');
const officialDocMigration = read('supabase/migrations/20260616001000_add_official_doc_graph_indexing_support.sql');
const focusedProductGraphRpcMigration = read('supabase/migrations/20260620000003_add_focused_product_graph_rpc.sql');
const retrievalResponseCacheMigration = read('supabase/migrations/20260620000004_create_compass_retrieval_response_cache.sql');
const graphService = read('src/lib/services/CompassEvidenceGraphService.ts');
const officialGuideIndexer = read('src/lib/services/CompassOfficialGuideGraphIndexer.ts');
const officialGuideGraphBackfillRoute = read('src/app/api/admin/source-ops/backfill-official-graph/route.ts');
const documentIndexer = read('src/lib/services/DocumentIndexingService.ts');
const ragService = read('src/lib/services/RAGSearchService.ts');
const llmService = read('src/lib/services/CompassAnswerLlmService.ts');
const plan = read('docs/rag/compass-evidence-graph-mvp-plan.md');

for (const tableName of [
  'compass.evidence_nodes',
  'compass.evidence_edges',
  'compass.evidence_assertions',
  'compass.resolved_cases',
  'compass.graph_retrieval_logs',
]) {
  assertIncludes(migration, tableName, 'evidence graph migration table');
}

for (const policySignal of [
  'approved_for_retrieval = true',
  'promote_learning_feedback_to_resolved_case',
  "source_kind IN ('official_doc', 'resolved_case')",
  "evidence_decision IN ('verified', 'weak', 'rejected')",
  "review_status IN ('candidate', 'approved', 'rejected', 'stale')",
]) {
  assertIncludes(migration, policySignal, 'evidence graph governance rule');
}

for (const serviceSignal of [
  'COMPASS_EVIDENCE_GRAPH_ENABLED',
  'approved_for_retrieval',
  'resolved_case',
  'official_doc',
  'searchCandidates',
  'OPERATIONAL_ISSUE_TERMS',
  'graphTopics',
  'COMPASS_EVIDENCE_GRAPH_FOCUSED_RPC_ENABLED',
  'isFocusedProductGraphRpcEnabled',
  'isFocusedProductGraphIntent',
  'fetchFocusedProductStructuredRowsFromRpc',
  'FOCUSED_PRODUCT_GRAPH_RPC_CACHE_TTL_MS',
  'getFocusedProductGraphRpcCacheStatus',
  'focusedProductGraphRpcCacheStats',
  'focusedProductGraphRpcCache',
  'readCompassRetrievalDurableCache',
  'writeCompassRetrievalDurableCache',
  "'focused_product_graph_rpc'",
  'durableHitCount',
  'awaitFocusedProductGraphRpcInflight',
  'shouldUseStructuredRowsOnlyForFocusedProductOverview',
  'resolveFocusedProductGraphRpcRowLimit',
  'resolveStructuredGraphPerQueryLimit',
  'resolveTextGraphRowLimit',
]) {
  assertIncludes(graphService, serviceSignal, 'evidence graph service contract');
}

for (const officialDocSignal of [
  'COMPASS_OFFICIAL_GUIDE_GRAPH_INDEXING_ENABLED',
  'indexOfficialGuideAssertions',
  "source_kind: 'official_doc'",
  "evidence_decision: 'verified'",
  "review_status: 'approved'",
  'claim_type',
  'sourceChunkId',
  'sourceCorpus',
  'officialGuideGraphIndexer',
]) {
  assertIncludes(officialGuideIndexer, officialDocSignal, 'official guide graph indexer contract');
}

for (const backfillSignal of [
  'guardCompassProductAdminSessionRoute',
  'document_chunks',
  'ollama_document_chunks',
  'dryRun',
  'const dryRun = body.dryRun !== false',
  'index-official-graph',
  'OFFICIAL_GRAPH_BACKFILL_CONFIRMATION_REQUIRED',
  'OFFICIAL_GRAPH_BACKFILL_FAILED',
  'compassOfficialGuideGraphIndexer',
]) {
  assertIncludes(officialGuideGraphBackfillRoute, backfillSignal, 'official guide graph backfill route contract');
}

for (const forbiddenBackfillSignal of [
  'dummyChunks',
  'embedding: null',
  ".from('document_chunks')\n      .delete()",
  ".from('document_chunks')\r\n      .delete()",
  'details: error instanceof Error',
  'String(error)',
]) {
  if (officialGuideGraphBackfillRoute.includes(forbiddenBackfillSignal)) {
    throw new Error(`official guide graph backfill route must not contain ${forbiddenBackfillSignal}`);
  }
}

for (const documentIndexerSignal of [
  'compassOfficialGuideGraphIndexer',
  'indexOfficialGuideGraphAssertions',
  "sourceType: 'url'",
  "sourceType: 'file'",
]) {
  assertIncludes(documentIndexer, documentIndexerSignal, 'document indexing official guide graph hook');
}

for (const officialDocMigrationSignal of [
  'evidence_assertions_official_doc_active_idx',
  'evidence_assertions_official_doc_vendor_claim_idx',
  'evidence_assertions_metadata_graph_topics_idx',
  'stale_official_doc_assertions',
]) {
  assertIncludes(officialDocMigration, officialDocMigrationSignal, 'official doc graph indexing migration');
}

for (const focusedProductGraphRpcSignal of [
  'search_focused_product_graph_assertions',
  'evidence_assertions_verified_vendor_source_created_idx',
  "GRANT EXECUTE ON FUNCTION compass.search_focused_product_graph_assertions",
]) {
  assertIncludes(focusedProductGraphRpcMigration, focusedProductGraphRpcSignal, 'focused product graph rpc migration');
}

for (const retrievalCacheSignal of [
  'compass.retrieval_response_cache',
  'cache_namespace text NOT NULL',
  'touch_retrieval_response_cache_hit',
  'prune_expired_retrieval_response_cache',
  'get_retrieval_response_cache_metrics',
  'Service role can manage retrieval response cache',
]) {
  assertIncludes(retrievalResponseCacheMigration, retrievalCacheSignal, 'retrieval response cache migration');
}

for (const ragSignal of [
  'CompassEvidenceGraphService',
  'searchEvidenceGraphCandidates',
  "corpus: 'evidence_graph'",
  "retrievalMethod: 'graph'",
  'evidence_graph_sidecar',
]) {
  assertIncludes(ragService, ragSignal, 'RAG graph sidecar integration');
}

if (!/resolveFocusedProductGraphRpcRowLimit[\s\S]*Math\.min\(Math\.max\(limit \* 3, 36\), 54\)/.test(graphService)) {
  fail('focused product graph RPC must keep row fan-out tightly bounded');
}

for (const promptSignal of [
  'sourceKind',
  'resolved_case',
  'official_doc',
  '실무 처리 사례',
  '확인 순서 / 가능한 원인 / 조치 방법 / 추가 확인 필요 항목',
]) {
  assertIncludes(llmService, promptSignal, 'answer prompt graph policy');
}

for (const planSignal of [
  'official_doc',
  'resolved_case',
  'Vector search',
  'Evidence Graph search',
  'promote_learning_feedback_to_resolved_case',
  'Open-Beta Governance',
  'Official Guide Backfill',
  'backfill-official-graph',
  'metadata.sourceChunkId',
]) {
  assertIncludes(plan, planSignal, 'evidence graph plan');
}

console.log('Compass evidence graph contract OK');
