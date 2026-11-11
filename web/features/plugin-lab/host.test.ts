import assert from 'node:assert/strict';
import test from 'node:test';
import { createSampleHost, MAX_MESSAGE_BYTES, messageBytes } from './host';

const request = (method = 'pages.list', id = '1') => ({ id, method, params: {} });
test('sample host projects at most 50 current pages without content or credentials', () => {
  const pages = Array.from({ length: 60 }, (_, n) => ({
    id: `p${n}`,
    title: `Page ${n}`,
    markdown: 'SECRET',
    token: 'SECRET',
  }));
  const host = createSampleHost(
    () => pages,
    () => {},
  );
  const reply = host.handle(request());
  assert.ok(reply && 'result' in reply);
  assert.equal(reply.result.length, 50);
  assert.deepEqual(Object.keys(reply.result[0]), ['id', 'title']);
  assert.ok(!JSON.stringify(reply).includes('SECRET'));
  assert.ok(messageBytes(reply) <= MAX_MESSAGE_BYTES);
});
test('response budget includes Unicode byte size and envelope', () => {
  const host = createSampleHost(
    () => Array.from({ length: 50 }, (_, n) => ({ id: `${n}`, title: '喵'.repeat(1000) })),
    () => {},
  );
  const reply = host.handle(request());
  assert.ok(reply && 'result' in reply);
  assert.ok(reply.result.length < 50);
  assert.ok(messageBytes(reply) <= MAX_MESSAGE_BYTES);
});
test('strict requests reject malformed, unknown and unauthorized methods without leaking payloads', () => {
  const logs: string[] = [];
  const host = createSampleHost(
    () => [],
    (text) => logs.push(text),
  );
  for (const value of [
    null,
    [],
    { ...request(), token: 'SECRET' },
    { ...request(), params: { content: 'SECRET' } },
    { ...request(), id: '' },
  ]) {
    const reply = host.handle(value);
    assert.ok(reply && 'error' in reply);
    assert.equal(reply.error.code, 'INVALID_REQUEST');
  }
  const forbidden = host.handle(request('workspace.summary'));
  assert.ok(forbidden && 'error' in forbidden);
  assert.equal(forbidden.error.code, 'PERMISSION_DENIED');
  const unknown = host.handle(request('credentials.SECRET'));
  assert.ok(unknown && 'error' in unknown);
  assert.equal(unknown.error.code, 'METHOD_NOT_FOUND');
  assert.ok(!logs.join(' ').includes('SECRET'));
});
test('oversized and cyclic messages fail closed', () => {
  const host = createSampleHost(
    () => [],
    () => {},
  );
  const oversized = host.handle({ ...request(), params: { large: '喵'.repeat(3000) } });
  assert.ok(oversized && 'error' in oversized);
  assert.equal(oversized.error.code, 'MESSAGE_TOO_LARGE');
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const cyclic = host.handle(cycle);
  assert.ok(cyclic && 'error' in cyclic);
  assert.equal(cyclic.error.code, 'MESSAGE_TOO_LARGE');
});
test('30-message budget spans requests including invalid payloads and dispose denies further use', () => {
  const host = createSampleHost(
    () => [],
    () => {},
  );
  for (let i = 0; i < 30; i += 1) assert.notEqual(host.handle(i % 2 ? request() : null), null);
  assert.equal(host.handle(request()), null);
  assert.equal(host.exhausted, true);
  const disposed = createSampleHost(
    () => [],
    () => {},
  );
  disposed.dispose();
  assert.equal(disposed.handle(request()), null);
});
