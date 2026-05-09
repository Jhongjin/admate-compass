import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const apiRoot = path.join(root, 'src/app/api')
const debugRoutePattern = /(debug|test|fix|force-regenerate|migrate|check-)/i
const sensitiveEnvPattern = /(SERVICE_ROLE|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)/
const publicAllowlist = new Set([
  path.join('src', 'app', 'api', 'latest-update', 'route.ts'),
])
const repairMutationRoutes = new Set([
  path.join('src', 'app', 'api', 'fix-embedding-dimension', 'route.ts'),
  path.join('src', 'app', 'api', 'fix-orphaned-chunks', 'route.ts'),
  path.join('src', 'app', 'api', 'force-regenerate-embeddings', 'route.ts'),
  path.join('src', 'app', 'api', 'admin', 'migrate', 'route.ts'),
])
const productionDisabledCandidates = new Set([
  path.join('src', 'app', 'api', 'debug-database-state', 'route.ts'),
  path.join('src', 'app', 'api', 'debug-embedding-data', 'route.ts'),
  path.join('src', 'app', 'api', 'debug-env', 'route.ts'),
  path.join('src', 'app', 'api', 'debug-rag', 'route.ts'),
  path.join('src', 'app', 'api', 'ollama', 'local-test', 'route.ts'),
  path.join('src', 'app', 'api', 'test-huggingface', 'route.ts'),
  path.join('src', 'app', 'api', 'test-integration', 'route.ts'),
  path.join('src', 'app', 'api', 'test-proxy', 'route.ts'),
  path.join('src', 'app', 'api', 'test-rag-search', 'route.ts'),
  path.join('src', 'app', 'api', 'test-rpc-direct', 'route.ts'),
  path.join('src', 'app', 'api', 'test-rpc-function', 'route.ts'),
])
const adminDiagnosticRoutes = new Set([
  path.join('src', 'app', 'api', 'admin', 'check-db', 'route.ts'),
  path.join('src', 'app', 'api', 'admin', 'check-schema', 'route.ts'),
  path.join('src', 'app', 'api', 'admin', 'debug-db', 'route.ts'),
  path.join('src', 'app', 'api', 'admin', 'test-filter', 'route.ts'),
  path.join('src', 'app', 'api', 'admin', 'users', 'check-admin', 'route.ts'),
  path.join('src', 'app', 'api', 'check-data-integrity', 'route.ts'),
  path.join('src', 'app', 'api', 'check-embedding-dimension', 'route.ts'),
  path.join('src', 'app', 'api', 'check-real-embedding-dimension', 'route.ts'),
  path.join('src', 'app', 'api', 'check-table-constraints', 'route.ts'),
])

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.isFile() && entry.name === 'route.ts' ? [full] : []
  })
}

let warnings = 0
let approvedPublic = 0
const warningCounts = {
  'repair-mutation': 0,
  'production-disabled-candidate': 0,
  'admin-diagnostic': 0,
  'unclassified-debug': 0,
}

function warningCategory(relative) {
  if (repairMutationRoutes.has(relative)) return 'repair-mutation'
  if (productionDisabledCandidates.has(relative)) return 'production-disabled-candidate'
  if (adminDiagnosticRoutes.has(relative)) return 'admin-diagnostic'
  return 'unclassified-debug'
}

for (const file of walk(apiRoot)) {
  const relative = path.relative(root, file)
  const text = fs.readFileSync(file, 'utf8')
  const isPublicAllowlisted = publicAllowlist.has(relative)
  if (isPublicAllowlisted) {
    approvedPublic += 1
  }
  if (!isPublicAllowlisted && debugRoutePattern.test(relative)) {
    const category = warningCategory(relative)
    warningCounts[category] += 1
    warnings += 1
    console.warn(`[check-admin-debug-surface] review ${category} route before production: ${relative}`)
  }
  if (sensitiveEnvPattern.test(text) && /NextResponse\.json\([^)]*process\.env/s.test(text)) {
    console.error(`[check-admin-debug-surface] possible env value response in ${relative}`)
    process.exitCode = 1
  }
}

if (!process.exitCode) {
  console.log(
    `[check-admin-debug-surface] ok (${warnings} review warnings, ${approvedPublic} public allowlist)`,
  )
  for (const [category, count] of Object.entries(warningCounts)) {
    if (count > 0) {
      console.log(`[check-admin-debug-surface] ${category}: ${count}`)
    }
  }
}
