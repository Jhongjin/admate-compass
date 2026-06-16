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
const graphService = read('src/lib/services/CompassEvidenceGraphService.ts');
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
]) {
  assertIncludes(graphService, serviceSignal, 'evidence graph service contract');
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
]) {
  assertIncludes(plan, planSignal, 'evidence graph plan');
}

console.log('Compass evidence graph contract OK');
