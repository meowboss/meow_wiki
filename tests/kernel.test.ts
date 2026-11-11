import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel, type Plugin } from '../src/kernel.ts';
const base: Plugin['manifest'] = {
  id: 'test.search',
  name: 'Search',
  description: '',
  version: '1',
  apiVersion: 1,
  kind: 'search',
  requires: [],
};
test('plugin effects roll back in reverse order and failures do not leak capabilities', () => {
  const kernel = new Kernel();
  const calls: number[] = [];
  assert.throws(() =>
    kernel.register({
      manifest: base,
      setup(register, effect) {
        register('search', () => []);
        effect(() => calls.push(1));
        effect(() => calls.push(2));
        throw new Error('failed');
      },
    }),
  );
  assert.deepEqual(calls, [2, 1]);
  assert.equal(kernel.list().length, 0);
  kernel.register({ manifest: base, setup: (register) => register('search', () => []) });
});
test('dependent unload is refused; dispose is reverse, idempotent and isolated from manifest mutation', () => {
  const kernel = new Kernel();
  const calls: string[] = [];
  kernel.register({ manifest: base, setup: (_r, effect) => effect(() => calls.push('search')) });
  kernel.register({
    manifest: { ...base, id: 'test.assistant', requires: [base.id] },
    setup: (_r, effect) => effect(() => calls.push('assistant')),
  });
  kernel.list()[0].requires.push('invalid');
  assert.throws(() => kernel.unregister(base.id));
  kernel.dispose();
  kernel.dispose();
  assert.deepEqual(calls, ['assistant', 'search']);
});
test('all disposers execute even when one fails, and registration can be reused', () => {
  const kernel = new Kernel();
  let cleaned = false;
  kernel.register({
    manifest: base,
    setup(register, effect) {
      register('search', () => []);
      effect(() => {
        cleaned = true;
      });
      effect(() => {
        throw new Error('cleanup');
      });
    },
  });
  assert.throws(() => kernel.dispose(), AggregateError);
  assert.equal(cleaned, true);
  assert.equal(kernel.list().length, 0);
  kernel.register({ manifest: base, setup: (register) => register('search', () => []) });
});
