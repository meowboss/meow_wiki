import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createDefaultComposition, type CanvasSurface } from '../packages/canvas-contract/index.ts';
import {
  PAGE_FILE,
  PAGE_SCHEMA_FILE,
  PAGE_SDK_INSTRUCTIONS,
  pageProjectFileSchema,
  parsePageProjectContent,
  validatePageProjectContent,
  type PageProjectFile,
} from '../packages/workshop-contract/index.ts';

function page(surface: CanvasSurface = 'home'): PageProjectFile {
  const { revision: _, ...composition } = createDefaultComposition(surface);
  return { format: 'meow.page', version: 1, name: '现有页面', composition };
}
const parse = (value: unknown) => parsePageProjectContent(JSON.stringify(value));

function invalid(value: unknown) {
  const result = parse(value);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.issues.length > 0 && result.issues.length <= 8);
    assert.ok(result.issues.every((issue) => typeof issue === 'string' && issue.length <= 160));
  }
  return result;
}

test('page project strict contract accepts all existing surfaces and excludes server revision', () => {
  assert.equal(PAGE_FILE, '/project/page.json');
  assert.equal(PAGE_SCHEMA_FILE, '/sdk/page.schema.json');
  for (const surface of ['home', 'wiki', 'collaboration'] as const) {
    const value = page(surface);
    assert.deepEqual(parse(value), { success: true, data: value });
    assert.deepEqual(validatePageProjectContent(JSON.stringify(value)), { valid: true });
    assert.ok(pageProjectFileSchema.safeParse(value).success);
    invalid({ ...value, revision: 0 });
    invalid({ ...value, expectedRevision: 0 });
    invalid({ ...value, composition: { ...value.composition, revision: 0 } });
  }
  const schema = z.toJSONSchema(pageProjectFileSchema);
  assert.equal(schema.additionalProperties, false);
  assert.ok(JSON.stringify(schema).includes('meow.page'));
});

test('page parsing accepts only inert JSON, rejects malformed and executable fields', () => {
  for (const content of [
    '',
    '{',
    'null',
    '[]',
    'true',
    '42',
    'undefined',
    '({})',
    '```json\n{}\n```',
    '(()=>{throw 1})()',
  ]) {
    assert.equal(parsePageProjectContent(content).success, false);
  }
  assert.equal(parsePageProjectContent(undefined).success, false);
  assert.equal(parsePageProjectContent({ toString: () => JSON.stringify(page()) }).success, false);
  for (const patch of [
    { format: 'meow.component' },
    { version: 2 },
    { name: '' },
    { name: 'a'.repeat(161) },
    { code: 'throw 1' },
    { script: 'alert(1)' },
    { html: '<script>throw 1</script>' },
    { imports: ['node:fs'] },
    { workspaceId: 'secret' },
    { owner: 'alice' },
  ])
    invalid({ ...page(), ...patch });
  for (const patch of [
    { surface: 'newnav' },
    { code: 'throw 1' },
    { instances: Array(41).fill(page().composition.instances[0]) },
  ])
    invalid({ ...page(), composition: { ...page().composition, ...patch } });
  const instance = page().composition.instances[0];
  for (const patch of [
    { viewId: 'arbitrary.javascript' },
    { config: { code: 'throw 1' } },
    { config: { html: '<script>' } },
    { style: { css: 'body{}' } },
    { x: 11, w: 2 },
  ])
    invalid({
      ...page(),
      composition: { ...page().composition, instances: [{ ...instance, ...patch }] },
    });
});

test('page content and metadata bounds include exact limit and Unicode input', () => {
  assert.equal(parse({ ...page(), name: 'a'.repeat(160) }).success, true);
  assert.equal(parse({ ...page(), name: '😀'.repeat(160) }).success, true);
  assert.equal(parse({ ...page(), name: '😀'.repeat(161) }).success, false);
  const content = JSON.stringify(page());
  assert.equal(parsePageProjectContent(content.padEnd(30000)).success, true);
  assert.equal(parsePageProjectContent(content.padEnd(30001)).success, false);
  const unicode = content + ' '.repeat(30000 - content.length - 2) + '😀';
  assert.equal(unicode.length, 30000);
  assert.ok(new TextEncoder().encode(unicode).byteLength <= 120000);
  assert.equal(parsePageProjectContent(unicode).success, false);
  assert.equal(parsePageProjectContent('😀'.repeat(30001)).success, false);
});

test('page composition reuses bounded complete layout tree validation', () => {
  const value = page();
  const leaves = value.composition.instances.map((instance, index) => ({
    id: `node-${index}`,
    kind: 'view',
    instanceId: instance.id,
  }));
  const withTree = (tree: unknown) => ({ ...value, composition: { ...value.composition, tree } });
  assert.equal(parse(withTree({ id: 'root', kind: 'flow', children: leaves })).success, true);
  invalid(withTree({ id: 'root', kind: 'flow', children: leaves.slice(1) }));
  invalid(withTree({ id: 'root', kind: 'flow', children: [...leaves, leaves[0]] }));
  invalid(withTree({ id: 'root', kind: 'view', instanceId: 'missing' }));
  invalid(withTree({ id: 'root', kind: 'flow', code: 'throw 1', children: leaves }));
  invalid(withTree({ id: 'root', kind: 'flow', children: Array(41).fill(leaves[0]) }));
  let deep: unknown = { id: 'leaf', kind: 'flow' };
  for (let i = 0; i < 6; i++) deep = { id: `deep-${i}`, kind: 'flow', children: [deep] };
  invalid(withTree(deep));
  invalid(
    withTree({
      id: 'root',
      kind: 'flow',
      children: Array.from({ length: 40 }, (_, i) => ({
        id: `branch-${i}`,
        kind: 'flow',
        children: [
          { id: `a-${i}`, kind: 'flow' },
          { id: `b-${i}`, kind: 'flow' },
        ],
      })),
    }),
  );
  const cyclic: { id: string; kind: string; children: unknown[] } = {
    id: 'cycle',
    kind: 'flow',
    children: [],
  };
  cyclic.children.push(cyclic);
  assert.equal(pageProjectFileSchema.safeParse(withTree(cyclic)).success, false);
});

test('validation issues are bounded sanitized strings without raw keys, identifiers or values', () => {
  const secret = 'provider_secret_DO_NOT_ECHO';
  const value = page();
  const result = invalid({
    ...value,
    [secret]: secret,
    name: 42,
    composition: {
      ...value.composition,
      background: secret,
      instances: value.composition.instances.map((instance) => ({
        ...instance,
        x: -1,
        w: 0,
        h: 0,
        visible: secret,
        config: { [secret]: secret },
        style: { [secret]: secret },
      })),
    },
  });
  assert.ok(!JSON.stringify(result).includes(secret));
  if (!result.success) assert.equal(result.issues.length, 8);
  const treeError = validatePageProjectContent(
    JSON.stringify({
      ...value,
      composition: {
        ...value.composition,
        tree: { id: 'root', kind: 'view', instanceId: secret },
      },
    }),
  );
  assert.equal(treeError.valid, false);
  assert.ok(!JSON.stringify(treeError).includes(secret));
  assert.ok(!JSON.stringify(parsePageProjectContent(`{"${secret}":`)).includes(secret));
});

test('page SDK documents actual views, schema resource and non-applying scope', () => {
  for (const term of [
    PAGE_FILE,
    PAGE_SCHEMA_FILE,
    'home',
    'wiki',
    'collaboration',
    'wiki.document',
    'home.controls',
    'collaboration.detail',
    'builtin.text',
    'component.render',
    'metadata',
    'secrets',
    'no apply tool',
    'existing surface',
    'revision',
  ]) {
    assert.ok(PAGE_SDK_INSTRUCTIONS.toLowerCase().includes(term.toLowerCase()), term);
  }
});
