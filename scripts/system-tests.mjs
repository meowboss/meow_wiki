import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Each spec receives a fresh Playwright-managed in-memory server. Keep real auth
// limits enabled: unrelated acceptance cases must not consume one shared IP bucket.
const requested = process.argv.slice(2);
const specs = requested.length ? requested : readdirSync('e2e').filter(name => name.endsWith('.spec.ts')).sort().map(name => `e2e/${name}`);
for (const spec of specs) {
  console.log(`\n=== Isolated system spec: ${spec} ===`);
  const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', spec], { stdio: 'inherit', env: process.env });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
