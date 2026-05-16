import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcRoot = path.join(root, "src");

const compassTables = [
  "documents",
  "document_metadata",
  "document_chunks",
  "ollama_document_chunks",
  "document_processing_logs",
  "url_templates",
  "processing_jobs",
  "document_splits",
  "discovered_urls",
  "crawl_jobs",
  "processing_metrics",
  "document_chunk_weights",
  "ad_policies",
  "source_proposal_runs",
  "source_proposal_queue",
];

const schemaAwareMarkers = [
  "@/lib/supabase/compass",
  "createCompassServiceClient",
  "createCompassBrowserClient",
  "VectorStorageService",
  "RAGSearchService",
];

const mustFixOperationalFiles = new Set([
  "src/app/api/download/[documentId]/route.ts",
  "src/app/api/related-questions/route.ts",
  "src/app/api/health/route.ts",
  "src/app/api/admin/document-actions/route.ts",
  "src/app/api/admin/upload/[documentId]/reindex/route.ts",
  "src/app/api/admin/monitoring/route.ts",
  "src/app/api/admin/simple-index/route.ts",
  "src/app/api/admin/sync-status/route.ts",
  "src/app/api/admin/clean-titles/route.ts",
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

const directPublicRefs = [];
const reviewRefs = [];
const mustFixRefs = [];

for (const file of walk(srcRoot)) {
  const text = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const usesCompassHelper = schemaAwareMarkers.some((marker) => text.includes(marker));

  for (const table of compassTables) {
    const fromPattern = new RegExp(`\\.from\\((['"\`])${table}\\1\\)`);
    const publicPattern = new RegExp(`public\\.${table}\\b`);

    if (publicPattern.test(text)) {
      directPublicRefs.push(`${relative}: public.${table}`);
    }

    if (fromPattern.test(text) && !usesCompassHelper) {
      const item = `${relative}: .from('${table}')`;
      if (mustFixOperationalFiles.has(relative)) {
        mustFixRefs.push(item);
      } else {
        reviewRefs.push(item);
      }
    }
  }
}

if (directPublicRefs.length > 0) {
  console.error("[check-compass-table-references] direct public-qualified references found:");
  for (const item of directPublicRefs) console.error(`- ${item}`);
  process.exitCode = 1;
}

if (mustFixRefs.length > 0) {
  console.error("[check-compass-table-references] must-fix operational references remain:");
  for (const item of mustFixRefs) console.error(`- ${item}`);
  process.exitCode = 1;
}

if (reviewRefs.length > 0) {
  console.warn("[check-compass-table-references] schema review references remain:");
  for (const item of reviewRefs) console.warn(`- ${item}`);
}

if (!process.exitCode) {
  console.log(
    `[check-compass-table-references] ok (${reviewRefs.length} schema review references)`
  );
}
