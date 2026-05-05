import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(process.cwd(), '.env.migration');
const envFileExists = fs.existsSync(envPath);

function parseEnv(content) {
  const parsed = new Map();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key) {
      parsed.set(key, value.length > 0);
    }
  }

  return parsed;
}

let hasSourceDbUrl = false;
let hasTargetDbUrl = false;

if (envFileExists) {
  const envFlags = parseEnv(fs.readFileSync(envPath, 'utf8'));
  hasSourceDbUrl = envFlags.get('SOURCE_DB_URL') === true;
  hasTargetDbUrl = envFlags.get('TARGET_DB_URL') === true;
}

const ready = envFileExists && hasSourceDbUrl && hasTargetDbUrl;

console.log(`[check-migration-env] envFileExists=${envFileExists}`);
console.log(`[check-migration-env] hasSourceDbUrl=${hasSourceDbUrl}`);
console.log(`[check-migration-env] hasTargetDbUrl=${hasTargetDbUrl}`);
console.log(`[check-migration-env] ready=${ready}`);
