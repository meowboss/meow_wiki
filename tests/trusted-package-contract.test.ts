import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  trustedPackageSchema,
  trustedViewIdSchema,
  type TrustedPackage,
} from '../packages/canvas-contract/trusted-packages.ts';

const metadata = (): TrustedPackage => ({
  id: 'official.summary',
  version: '1.2.3',
  views: [
    {
      id: 'official.summary.overview',
      title: 'Summary overview',
      surfaces: ['home', 'wiki'],
    },
  ],
});

test('trusted package metadata supports new renderer slugs without a closed enum', () => {
  const input = metadata();
  const before = structuredClone(input);
  assert.deepEqual(trustedPackageSchema.parse(input), input);
  assert.deepEqual(input, before);
  for (const name of ['new-renderer', 'a', 'release-2026']) {
    assert.equal(trustedViewIdSchema.safeParse(`official.summary.${name}`).success, true);
  }
  const slug = 'a'.repeat(48);
  assert.equal(trustedViewIdSchema.safeParse(`official.${slug}.${slug}`).success, true);
  assert.equal(trustedViewIdSchema.safeParse(`official.${slug}a.view`).success, false);
  assert.equal(trustedViewIdSchema.safeParse(`official.package.${slug}a`).success, false);
});

test('trusted IDs reject malicious paths, code strings and malformed namespaces', () => {
  for (const id of [
    '',
    'official.summary',
    'official.summary.overview.extra',
    'untrusted.summary.overview',
    'official.Summary.overview',
    'official.summary.Overview',
    'official.1summary.overview',
    'official.summary.-overview',
    'official.summary.view_name',
    'official.summary../view',
    'official.summary.<script>',
    'official.summary.%2e%2e',
    'official.summary.view?eval=1',
    'official.summary.view\n',
    'official.summary.view\u0000',
    'official.summary.视图',
    'official.summary.' + 'x'.repeat(111),
  ]) {
    assert.equal(trustedViewIdSchema.safeParse(id).success, false, JSON.stringify(id));
  }
  for (const id of [
    'official',
    'official.summary.extra',
    'official../summary',
    'official.Summary',
    'official.1summary',
    'official.' + 'a'.repeat(49),
    'official.summary\n',
  ]) {
    assert.equal(trustedPackageSchema.safeParse({ ...metadata(), id }).success, false, id);
  }
});

test('trusted metadata is strict and has no executable fields or permissions', () => {
  for (const extra of [
    { unknown: true },
    { permissions: ['eval'] },
    { eval: 'alert(1)' },
    { entrypoint: './renderer.js' },
    { render: () => null },
  ]) {
    assert.equal(trustedPackageSchema.safeParse({ ...metadata(), ...extra }).success, false);
    const input = metadata();
    input.views[0] = { ...input.views[0], ...extra };
    assert.equal(trustedPackageSchema.safeParse(input).success, false);
  }
});

test('trusted packages reject duplicate view IDs and foreign package prefixes', () => {
  const duplicate = metadata();
  duplicate.views.push({ ...duplicate.views[0], title: 'Another title', surfaces: ['wiki'] });
  const duplicateResult = trustedPackageSchema.safeParse(duplicate);
  assert.equal(duplicateResult.success, false);
  if (!duplicateResult.success) {
    assert.ok(duplicateResult.error.issues.some((issue) => issue.path.join('.') === 'views.1.id'));
  }
  for (const id of ['official.other.overview', 'official.summary-extra.overview']) {
    const input = metadata();
    input.views[0].id = id;
    assert.equal(trustedPackageSchema.safeParse(input).success, false, id);
  }
});

test('trusted package versions are bounded SemVer strings', () => {
  for (const version of [
    '0.0.0',
    '12.34.56',
    '1.0.0-rc.1',
    '1.0.0-0',
    '1.0.0+build.01',
    '1.0.0-beta.1+sha-abc',
  ]) {
    assert.equal(trustedPackageSchema.safeParse({ ...metadata(), version }).success, true, version);
  }
  for (const version of [
    '',
    '1',
    '1.2',
    'v1.2.3',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-01',
    '1.2.3-alpha..1',
    '1.2.3+',
    '1.2.3+build..1',
    '1.2.3\n',
    ' 1.2.3',
    '1.2.3 ',
    '1.2.3/',
    '1.2.3+' + 'a'.repeat(59),
    123,
  ]) {
    assert.equal(
      trustedPackageSchema.safeParse({ ...metadata(), version }).success,
      false,
      String(version),
    );
  }
  assert.equal(
    trustedPackageSchema.safeParse({ ...metadata(), version: '1.2.3+' + 'a'.repeat(58) }).success,
    true,
  );
});

test('trusted package views, titles and unique surfaces have bounded cardinality', () => {
  const twenty = metadata();
  twenty.views = Array.from({ length: 20 }, (_, i) => ({
    id: `official.summary.view-${i}`,
    title: 'x'.repeat(100),
    surfaces: ['home', 'wiki', 'collaboration'],
  }));
  assert.equal(trustedPackageSchema.safeParse(twenty).success, true);
  assert.equal(
    trustedPackageSchema.safeParse({
      ...twenty,
      views: [...twenty.views, { ...twenty.views[0], id: 'official.summary.extra' }],
    }).success,
    false,
  );
  assert.equal(trustedPackageSchema.safeParse({ ...metadata(), views: [] }).success, false);
  for (const title of ['', 'x'.repeat(101)]) {
    const input = metadata();
    input.views[0].title = title;
    assert.equal(trustedPackageSchema.safeParse(input).success, false);
  }
  for (const surfaces of [
    [],
    ['home', 'home'],
    ['unknown'],
    ['home', 'wiki', 'collaboration', 'home'],
  ]) {
    const input = metadata();
    assert.equal(
      trustedPackageSchema.safeParse({ ...input, views: [{ ...input.views[0], surfaces }] })
        .success,
      false,
    );
  }
});
