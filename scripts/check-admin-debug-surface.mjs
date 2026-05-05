import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const apiRoot = path.join(root, 'src/app/api')
const debugRoutePattern = /(debug|test|fix|force-regenerate|migrate|check-)/i
const sensitiveEnvPattern = /(SERVICE_ROLE|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)/

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.isFile() && entry.name === 'route.ts' ? [full] : []
  })
}

let warnings = 0
for (const file of walk(apiRoot)) {
  const relative = path.relative(root, file)
  const text = fs.readFileSync(file, 'utf8')
  if (debugRoutePattern.test(relative)) {
    warnings += 1
    console.warn(`[check-admin-debug-surface] review debug/admin route before production: ${relative}`)
  }
  if (sensitiveEnvPattern.test(text) && /NextResponse\.json\([^)]*process\.env/s.test(text)) {
    console.error(`[check-admin-debug-surface] possible env value response in ${relative}`)
    process.exitCode = 1
  }
}

if (!process.exitCode) console.log(`[check-admin-debug-surface] ok (${warnings} review warnings)`)
