import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(resolve(directory, entry.name))
      : /\.[cm]?[jt]sx?$/.test(entry.name)
        ? [resolve(directory, entry.name)]
        : [],
  );
}
function imports(file: string) {
  return [...readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  );
}
test('browser features depend on shared contracts, never server internals or app assembly', () => {
  for (const file of files('web'))
    for (const specifier of imports(file)) {
      assert.ok(!specifier.startsWith('node:'), `Node builtin in browser: ${file}`);
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(file), specifier);
      const source = relative(resolve('web'), file).replaceAll('\\', '/');
      const destination = relative(resolve('web'), target).replaceAll('\\', '/');
      assert.ok(
        !destination.startsWith('../'),
        `Browser import escapes boundary: ${source} -> ${specifier}`,
      );
      if (source.startsWith('features/')) {
        assert.ok(!destination.startsWith('app/'), `Feature imports assembly: ${source}`);
        const own = source.split('/')[1];
        assert.ok(
          !destination.startsWith('features/') || destination.split('/')[1] === own,
          `Cross-feature import: ${source} -> ${destination}`,
        );
      }
      if (source.startsWith('shared/'))
        assert.ok(
          destination.startsWith('shared/'),
          `Shared imports a feature/app: ${source} -> ${destination}`,
        );
    }
});
test('application services do not depend on HTTP framework or route handlers', () => {
  for (const file of files('src')) {
    if (!file.endsWith('service.ts')) continue;
    for (const specifier of imports(file))
      assert.ok(
        !specifier.includes('fastify') &&
          !specifier.includes('/http') &&
          !specifier.includes('routes'),
        `${file} depends on HTTP ${specifier}`,
      );
  }
});
