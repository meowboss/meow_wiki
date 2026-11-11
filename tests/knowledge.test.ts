import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KnowledgeService, KnowledgeError } from '../src/knowledge.ts';

function fixture(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY,owner TEXT NOT NULL);
    INSERT OR IGNORE INTO workspaces VALUES ('a','alice'),('a2','alice'),('b','bob');`);
  return { db, service: new KnowledgeService(db), close: () => db.close() };
}
const status = (code: number) => (error: unknown) => error instanceof KnowledgeError && error.statusCode === code;

test('create queues without processing, detail alone includes content; chunk overlap and run idempotency', () => {
  const f = fixture();
  try {
    const content = 'a'.repeat(900) + '重叠关键词'.repeat(20) + 'b'.repeat(1100);
    const source = f.service.create('alice', 'a', { title: ' 文本笔记 ', content });
    assert.equal(source.title, '文本笔记');
    assert.equal(source.revision, 1);
    assert.equal(source.status, 'queued');
    assert.ok(!('content' in source));
    assert.ok(!('content' in f.service.list('alice', 'a')[0]));
    assert.equal(f.service.detail('alice', 'a', source.id).content, content);
    assert.deepEqual(f.service.search('alice', 'a', '重叠关键词'), []);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM knowledge_chunks').get()!.n, 0);
    assert.equal(f.service.listJobs('alice', 'a')[0].attempt, 1);
    assert.equal(f.service.prepare('alice', 'a', source.id).id, f.service.prepare('alice', 'a', source.id).id);
    assert.equal(f.service.run('alice', 'a', source.id).status, 'ready');
    const chunks = f.db.prepare('SELECT id,content FROM knowledge_chunks WHERE workspace_id=? ORDER BY ordinal').all('a');
    assert.equal(chunks.length, 3);
    assert.equal(String(chunks[0].content).length, 1000);
    assert.equal(String(chunks[0].content).slice(-100), String(chunks[1].content).slice(0, 100));
    const hits = f.service.search('alice', 'a', '重叠关键词');
    assert.ok(hits.length > 0);
    assert.deepEqual(Object.keys(hits[0]).sort(), ['chunkId', 'excerpt', 'revision', 'sourceId', 'title']);
    assert.equal(hits[0].sourceId, source.id);
    f.service.run('alice', 'a', source.id);
    assert.deepEqual(f.db.prepare('SELECT id,content FROM knowledge_chunks WHERE workspace_id=? ORDER BY ordinal').all('a'), chunks);
    assert.equal(f.service.listJobs('alice', 'a').length, 1);
  } finally { f.close(); }
});

test('CAS update invalidates old revision immediately and never searches retained obsolete chunks', () => {
  const f = fixture();
  try {
    const s = f.service.create('alice', 'a', { title: '旧标题', content: '旧版本独有词' });
    f.service.run('alice', 'a', s.id);
    assert.equal(f.service.search('alice', 'a', '旧版本独有词').length, 1);
    const updated = f.service.update('alice', 'a', s.id, { title: '新标题', content: '新版本独有词', expectedRevision: 1 });
    assert.equal(updated.revision, 2);
    assert.equal(updated.status, 'queued');
    assert.throws(() => f.service.update('alice', 'a', s.id, { title: '冲突', content: '错误', expectedRevision: 1 }), status(409));
    assert.equal(f.service.detail('alice', 'a', s.id).content, '新版本独有词');
    assert.deepEqual(f.service.search('alice', 'a', '旧版本独有词'), []);
    // Defense in depth: even an obsolete chunk left on disk must not be returned.
    f.db.prepare('INSERT INTO knowledge_chunks VALUES (?,?,?,?,?,?)').run('stale', 'a', s.id, 1, 0, '旧版本独有词');
    assert.deepEqual(f.service.search('alice', 'a', '旧版本独有词'), []);
    f.service.run('alice', 'a', s.id);
    assert.deepEqual(f.service.search('alice', 'a', '旧版本独有词'), []);
    assert.equal(f.service.search('alice', 'a', '新版本独有词')[0].revision, 2);
    const jobs = f.service.listJobs('alice', 'a');
    assert.equal(jobs.find(j => j.revision === 1)!.status, 'cancelled');
    assert.equal(jobs.find(j => j.revision === 2)!.status, 'ready');
  } finally { f.close(); }
});

test('delete is a durable tombstone, cancels jobs/chunks and cannot be resurrected by run', () => {
  const f = fixture();
  try {
    for (const ready of [false, true]) {
      const s = f.service.create('alice', 'a', { title: '删除', content: '被删除的秘密' });
      if (ready) f.service.run('alice', 'a', s.id);
      assert.ok(f.service.remove('alice', 'a', s.id).deletedAt);
      assert.equal(f.db.prepare('SELECT status FROM knowledge_sources WHERE workspace_id=? AND id=?').get('a', s.id)!.status, 'cancelled');
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM knowledge_chunks WHERE workspace_id=? AND source_id=?').get('a', s.id)!.n, 0);
      assert.throws(() => f.service.run('alice', 'a', s.id), status(404));
      assert.throws(() => f.service.prepare('alice', 'a', s.id), status(404));
      assert.throws(() => f.service.detail('alice', 'a', s.id), status(404));
      assert.throws(() => f.service.update('alice', 'a', s.id, { title: '复活', content: '否', expectedRevision: 1 }), status(404));
    }
    assert.deepEqual(f.service.list('alice', 'a'), []);
    assert.deepEqual(f.service.search('alice', 'a', '秘密'), []);
    assert.ok(f.service.listJobs('alice', 'a').every(j => j.status === 'cancelled'));
  } finally { f.close(); }
});

test('every API scopes workspace ownership; source identifiers cannot cross even same-owner workspaces', () => {
  const f = fixture();
  try {
    const s = f.service.create('alice', 'a', { title: '私有', content: '不可越界' });
    f.service.run('alice', 'a', s.id);
    for (const [owner, wid] of [['bob', 'a'], ['alice', 'b'], ['alice', 'missing']]) {
      for (const call of [
        () => f.service.create(owner, wid, { title: '入侵', content: '入侵' }),
        () => f.service.list(owner, wid), () => f.service.listJobs(owner, wid),
        () => f.service.search(owner, wid, '不可越界'), () => f.service.detail(owner, wid, s.id),
        () => f.service.prepare(owner, wid, s.id), () => f.service.run(owner, wid, s.id),
        () => f.service.remove(owner, wid, s.id),
        () => f.service.update(owner, wid, s.id, { title: '入侵', content: '入侵', expectedRevision: 1 }),
      ]) assert.throws(call, status(404));
    }
    for (const call of [
      () => f.service.detail('alice', 'a2', s.id), () => f.service.run('alice', 'a2', s.id),
      () => f.service.prepare('alice', 'a2', s.id), () => f.service.remove('alice', 'a2', s.id),
      () => f.service.update('alice', 'a2', s.id, { title: '入侵', content: '入侵', expectedRevision: 1 }),
    ]) assert.throws(call, status(404));
    assert.deepEqual(f.service.search('alice', 'a2', '不可越界'), []);
    assert.deepEqual(f.service.listJobs('alice', 'a2'), []);
    assert.equal(f.service.search('alice', 'a', '不可越界').length, 1);
  } finally { f.close(); }
});

test('input limits, SQL literals, top-eight search, markdown and Unicode chunking', () => {
  const f = fixture();
  try {
    for (const input of [null, {}, { title: '', content: 'a' }, { title: '  ', content: 'a' },
      { title: 'x'.repeat(201), content: 'a' }, { title: 'ok', content: '' },
      { title: 'ok', content: 7 }, { title: 'ok', content: 'x'.repeat(200001) }]) {
      assert.throws(() => f.service.create('alice', 'a', input as never), status(400));
    }
    const s = f.service.create('alice', 'a', { title: 'x'.repeat(200), content: 'x'.repeat(200000) });
    assert.equal(f.service.detail('alice', 'a', s.id).content.length, 200000);
    for (const expectedRevision of [0, -1, 1.2, NaN, '1', undefined]) {
      assert.throws(() => f.service.update('alice', 'a', s.id, { title: 'ok', content: 'ok', expectedRevision } as never), status(400));
    }
    assert.throws(() => f.service.search('alice', 'a', 'x'.repeat(1001)), status(400));
    assert.throws(() => f.service.search('alice', 'a', null as never), status(400));
    assert.deepEqual(f.service.search('alice', 'a', '  '), []);
    assert.deepEqual(f.service.search('alice', 'a', "%' OR 1=1 --"), []);
    for (let i = 0; i < 10; i++) {
      const item = f.service.create('alice', 'a', { title: `Markdown ${i}`, content: '# LOCAL\n\n**匹配** ' + '🐱'.repeat(1100) });
      f.service.run('alice', 'a', item.id);
    }
    assert.equal(f.service.search('alice', 'a', 'local').length, 8);
    const chunk = f.db.prepare('SELECT content FROM knowledge_chunks WHERE workspace_id=? ORDER BY rowid LIMIT 1').get('a')!;
    assert.equal(Array.from(String(chunk.content)).length, 1000);
    assert.ok(!String(chunk.content).includes('\ufffd'));
  } finally { f.close(); }
});

test('failed attempts persist and retry atomically without duplicate chunks', () => {
  const f = fixture();
  try {
    const s = f.service.create('alice', 'a', { title: '重试', content: '重试内容'.repeat(500) });
    f.db.exec("CREATE TRIGGER fail_chunks BEFORE INSERT ON knowledge_chunks BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
    assert.throws(() => f.service.run('alice', 'a', s.id), status(500));
    assert.equal(f.service.list('alice', 'a')[0].status, 'failed');
    assert.equal(f.service.listJobs('alice', 'a')[0].status, 'failed');
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM knowledge_chunks').get()!.n, 0);
    f.db.exec('DROP TRIGGER fail_chunks');
    assert.equal(f.service.run('alice', 'a', s.id).status, 'ready');
    const jobs = f.service.listJobs('alice', 'a');
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].attempt, 2);
    assert.equal(jobs[0].status, 'ready');
    assert.equal(jobs[1].status, 'failed');
    f.service.run('alice', 'a', s.id);
    assert.equal(f.service.listJobs('alice', 'a').length, 2);
  } finally { f.close(); }
});

test('restart retains sources, revisions, chunks, jobs and queued work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'meow-knowledge-'));
  const path = join(directory, 'knowledge.sqlite');
  let f = fixture(path);
  try {
    const s = f.service.create('alice', 'a', { title: '持久资料', content: '持久关键词' });
    const queued = f.service.create('alice', 'a', { title: '等待处理', content: '队列关键词' });
    const removed = f.service.create('alice', 'a', { title: '已删除', content: '不能复活' });
    f.service.run('alice', 'a', s.id);
    f.service.remove('alice', 'a', removed.id);
    const hits = f.service.search('alice', 'a', '持久关键词');
    f.close();
    f = fixture(path);
    assert.deepEqual(f.service.search('alice', 'a', '持久关键词'), hits);
    assert.equal(f.service.detail('alice', 'a', s.id).content, '持久关键词');
    assert.equal(f.service.listJobs('alice', 'a').length, 3);
    assert.equal(f.service.run('alice', 'a', queued.id).status, 'ready');
    assert.throws(() => f.service.run('alice', 'a', removed.id), status(404));
    assert.equal(f.service.run('alice', 'a', s.id).status, 'ready');
    assert.equal(f.service.listJobs('alice', 'a').length, 3);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM knowledge_revisions WHERE workspace_id=?').get('a')!.n, 3);
    const plans = f.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM knowledge_chunks WHERE workspace_id=? AND source_id=? AND revision=?').all('a', s.id, 1);
    assert.match(JSON.stringify(plans), /INDEX/);
  } finally { f.close(); rmSync(directory, { recursive: true, force: true }); }
});
