import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ComponentError, ComponentService, type ComponentInput } from '../src/components.ts';

const input: ComponentInput = { name: 'Reading card', description: 'Private declaration', template: '# Notes', blocks: [{ type: 'markdown', text: 'Text only' }] };
const fixture = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, owner TEXT NOT NULL);
    INSERT INTO workspaces VALUES ('alice-space', 'alice'), ('alice-other', 'alice'), ('bob-space', 'bob');`);
  return { db, service: new ComponentService(db) };
};
const status = (code: number) => (error: unknown) => {
  assert.ok(error instanceof ComponentError);
  assert.equal(error.statusCode, code);
  return true;
};

test('drafts are private to both author and workspace; scope violations are 404', () => {
  const { db, service } = fixture();
  try {
    const draft = service.create('alice', 'alice-space', input);
    assert.equal(draft.version, 1);
    assert.deepEqual(service.list('alice', 'alice-space'), [draft]);
    assert.deepEqual(service.list('bob', 'bob-space'), []);
    assert.deepEqual(service.list('alice', 'alice-other'), []);
    for (const [author, workspace] of [['bob', 'alice-space'], ['alice', 'bob-space'], ['alice', 'missing']]) {
      assert.throws(() => service.create(author, workspace, input), status(404));
      assert.throws(() => service.list(author, workspace), status(404));
      assert.throws(() => service.update(author, workspace, draft.id, input), status(404));
      assert.throws(() => service.submit(author, workspace, draft.id), status(404));
    }
    assert.throws(() => service.update('alice', 'alice-other', draft.id, input), status(404));
    assert.throws(() => service.submit('bob', 'bob-space', draft.id), status(404));
    assert.deepEqual(service.marketplace(), []);
  } finally { db.close(); }
});

test('moderation rejects self-review; one submission per revision; explicit terminal state transitions', () => {
  const { db, service } = fixture();
  try {
    const draft = service.create('alice', 'alice-space', input);
    const release = service.submit('alice', 'alice-space', draft.id);
    assert.equal(release.status, 'pending');
    assert.equal(release.authorId, 'alice');
    assert.equal(release.reviewerId, null);
    assert.equal(release.reason, null);
    assert.ok(!Object.keys(release).some(key => key.includes('_')));
    assert.deepEqual(service.pending(), [release]);
    assert.throws(() => service.submit('alice', 'alice-space', draft.id), status(409));
    assert.throws(() => service.review('alice', release.id, 'published', ''), status(403));
    assert.throws(() => service.review('alice', release.id, 'rejected', ''), status(403));
    assert.throws(() => service.review('admin', release.id, 'withdrawn', ''), status(409));
    const rejected = service.review('admin', release.id, 'rejected', 'Needs changes');
    assert.equal(rejected.reviewerId, 'admin');
    assert.equal(rejected.reason, 'Needs changes');
    assert.equal(rejected.status, 'rejected');
    assert.deepEqual(service.pending(), []);
    assert.deepEqual(service.marketplace(), []);
    assert.throws(() => service.review('admin', release.id, 'published', ''), status(409));
    assert.throws(() => service.install('bob-space', release.id), status(409));
    assert.throws(() => service.submit('alice', 'alice-space', draft.id), status(409));
    service.update('alice', 'alice-space', draft.id, { ...input, name: 'Revised' });
    const next = service.submit('alice', 'alice-space', draft.id);
    assert.equal(next.version, 2);
    assert.notEqual(next.id, release.id);
    const published = service.review('admin', next.id, 'published', 'Approved');
    assert.deepEqual(service.marketplace(), [published]);
    assert.throws(() => service.review('admin', next.id, 'published', ''), status(409));
    assert.throws(() => service.review('admin', next.id, 'rejected', ''), status(409));
    assert.throws(() => service.review('admin', 'missing', 'published', ''), status(404));
  } finally { db.close(); }
});

test('release digest and installed snapshot are immutable across draft updates and caller mutation', () => {
  const { db, service } = fixture();
  try {
    const source = structuredClone(input);
    const draft = service.create('alice', 'alice-space', source);
    source.name = 'Mutated input';
    const release = service.submit('alice', 'alice-space', draft.id);
    assert.equal(release.digest, createHash('sha256').update(JSON.stringify(input)).digest('hex'));
    service.review('admin', release.id, 'published', '');
    const installed = service.install('bob-space', release.id);
    assert.deepEqual(service.install('bob-space', release.id), installed);
    assert.equal(service.installed('bob-space').length, 1);
    const updated = service.update('alice', 'alice-space', draft.id, { ...input, template: 'Completely changed', blocks: [] });
    assert.equal(updated.version, 2);
    release.name = 'Mutated return';
    installed.release.template = 'Mutated install';
    const current = service.installed('bob-space')[0].release;
    assert.equal(current.name, input.name);
    assert.equal(current.template, input.template);
    assert.equal(current.version, 1);
    assert.equal(current.digest, release.digest);
    assert.equal(current.workspaceId, 'alice-space');
    assert.deepEqual(service.installed('alice-other'), []);
    assert.throws(() => db.prepare('UPDATE mw_releases SET content = ? WHERE id = ?').run('{}', release.id), /immutable/);
    assert.equal(new ComponentService(db).installed('bob-space')[0].release.template, input.template);
  } finally { db.close(); }
});

test('withdrawal removes public listing and blocks new installs but preserves old installed definitions and layouts', () => {
  const { db, service } = fixture();
  try {
    const draft = service.create('alice', 'alice-space', input);
    const release = service.submit('alice', 'alice-space', draft.id);
    service.review('admin', release.id, 'published', 'Approved');
    service.install('bob-space', release.id);
    assert.throws(() => service.review('alice', release.id, 'withdrawn', ''), status(403));
    const withdrawn = service.review('moderator', release.id, 'withdrawn', 'Policy change');
    assert.equal(withdrawn.status, 'withdrawn');
    assert.equal(withdrawn.reviewerId, 'moderator');
    assert.deepEqual(service.marketplace(), []);
    assert.throws(() => service.install('alice-other', release.id), status(409));
    assert.throws(() => service.install('bob-space', release.id), status(409));
    assert.equal(service.installed('bob-space')[0].release.template, input.template);
    const layout = { title: 'Existing installation', blocks: [{ releaseId: release.id }] };
    assert.deepEqual(service.saveLayout('bob', 'bob-space', layout), layout);
    assert.deepEqual(service.layout('bob-space'), layout);
    assert.throws(() => service.review('admin', release.id, 'published', ''), status(409));
  } finally { db.close(); }
});

test('layouts reject foreign drafts and uninstalled releases atomically; return saved definitions', () => {
  const { db, service } = fixture();
  try {
    assert.equal(service.layout('alice-space'), null);
    const own = service.create('alice', 'alice-space', input);
    const other = service.create('alice', 'alice-other', input);
    const foreign = service.create('bob', 'bob-space', input);
    const release = service.submit('bob', 'bob-space', foreign.id);
    service.review('admin', release.id, 'published', '');
    const initial = { title: 'Mine', blocks: [{ componentId: own.id }] };
    service.saveLayout('alice', 'alice-space', initial);
    for (const block of [{ componentId: other.id }, { componentId: foreign.id }, { releaseId: release.id }, { componentId: 'missing' }]) {
      assert.throws(() => service.saveLayout('alice', 'alice-space', { title: 'Denied', blocks: [block] }), status(404));
      assert.deepEqual(service.layout('alice-space'), initial);
    }
    assert.throws(() => service.saveLayout('bob', 'alice-space', initial), status(404));
    service.install('alice-space', release.id);
    const mixed = { title: 'Mixed', blocks: [{ componentId: own.id }, { releaseId: release.id }] };
    assert.deepEqual(service.saveLayout('alice', 'alice-space', mixed), mixed);
    mixed.title = 'Changed caller object';
    assert.equal(service.layout('alice-space')!.title, 'Mixed');
    assert.equal(service.layout('bob-space'), null);
  } finally { db.close(); }
});

test('all inputs are validated, including schema limits, unsupported execution fields and layout ambiguity', () => {
  const { db, service } = fixture();
  try {
    for (const invalid of [null, {}, { ...input, name: '' }, { ...input, name: 'x'.repeat(161) },
      { ...input, description: 'x'.repeat(501) }, { ...input, template: 'x'.repeat(10001) },
      { ...input, blocks: Array(21).fill({ type: 'search', title: '' }) },
      { ...input, blocks: [{ type: 'javascript', text: 'run()' }] },
      { ...input, blocks: [{ type: 'markdown', text: 'x'.repeat(10001) }] },
      { ...input, blocks: [{ type: 'page-list', title: 'x'.repeat(161) }] },
      { ...input, blocks: [{ type: 'search', title: '', script: 'run()' }] }, { ...input, script: 'run()' },
    ]) assert.throws(() => service.create('alice', 'alice-space', invalid), status(400));
    const draft = service.create('alice', 'alice-space', { name: 'x'.repeat(160), description: 'x'.repeat(500), template: 'x'.repeat(10000), blocks: Array(20).fill({ type: 'search', title: 'x'.repeat(160) }) });
    assert.throws(() => service.update('alice', 'alice-space', draft.id, null), status(400));
    for (const invalid of ['', null, 42, 'x'.repeat(201)]) {
      assert.throws(() => service.list(invalid as string, 'alice-space'), status(400));
      assert.throws(() => service.installed(invalid as string), status(400));
      assert.throws(() => service.layout(invalid as string), status(400));
      assert.throws(() => service.install('alice-space', invalid as string), status(400));
    }
    const release = service.submit('alice', 'alice-space', draft.id);
    assert.throws(() => service.review('admin', release.id, 'pending' as 'published', ''), status(400));
    assert.throws(() => service.review('admin', release.id, 'published', null as unknown as string), status(400));
    assert.throws(() => service.review('admin', release.id, 'published', 'x'.repeat(2001)), status(400));
    for (const invalid of [null, {}, { title: '', blocks: [] }, { title: 'x'.repeat(161), blocks: [] },
      { title: 'X', blocks: [{}] }, { title: 'X', blocks: [{ componentId: draft.id, releaseId: release.id }] },
      { title: 'X', blocks: [{ componentId: draft.id, script: 'run()' }] },
      { title: 'X', blocks: Array(13).fill({ componentId: draft.id }) },
    ]) assert.throws(() => service.saveLayout('alice', 'alice-space', invalid), status(400));
    assert.equal(service.saveLayout('alice', 'alice-space', { title: 'Max', blocks: Array(12).fill({ componentId: draft.id }) }).blocks.length, 12);
    assert.throws(() => service.installed('missing'), status(404));
    assert.throws(() => service.layout('missing'), status(404));
    assert.throws(() => service.install('alice-space', 'missing'), status(404));
  } finally { db.close(); }
});

test('templates and markdown remain inert plain text, never evaluated or interpolated', () => {
  const { db, service } = fixture();
  const global = globalThis as typeof globalThis & { componentExecuted?: boolean };
  global.componentExecuted = false;
  try {
    const code = '<script>globalThis.componentExecuted = true</script>${globalThis.componentExecuted = true}';
    const content = { name: code, description: code, template: code, blocks: [{ type: 'markdown' as const, text: code }] };
    const draft = service.create('alice', 'alice-space', content);
    const release = service.submit('alice', 'alice-space', draft.id);
    service.review('admin', release.id, 'published', '');
    service.install('bob-space', release.id);
    assert.equal(service.list('alice', 'alice-space')[0].template, code);
    assert.equal(service.marketplace()[0].template, code);
    assert.equal(service.installed('bob-space')[0].release.template, code);
    assert.equal(global.componentExecuted, false);
  } finally { delete global.componentExecuted; db.close(); }
});

test('transaction failures roll back and storage errors do not leak SQL internals', () => {
  const { db, service } = fixture();
  try {
    const draft = service.create('alice', 'alice-space', input);
    db.exec(`CREATE TRIGGER fail_release BEFORE INSERT ON mw_releases BEGIN SELECT RAISE(ABORT, 'secret database detail'); END`);
    assert.throws(() => service.submit('alice', 'alice-space', draft.id), error => {
      status(500)(error);
      assert.doesNotMatch((error as Error).message, /secret|INSERT|mw_releases/);
      return true;
    });
    assert.equal(db.prepare('SELECT count(*) AS n FROM mw_releases').get()!.n, 0);
    db.exec('DROP TRIGGER fail_release');
    assert.equal(service.submit('alice', 'alice-space', draft.id).status, 'pending');
    db.close();
    assert.throws(() => service.pending(), status(500));
  } finally { if (db.isOpen) db.close(); }
});
