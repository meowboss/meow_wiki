import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Hook-only harness: no DOM, server, persisted data or provider credentials.
function createdPagesHarness() {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const same = (a: unknown[], b: unknown[]) =>
    a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(value: unknown) {
      const index = cursor++;
      return (slots[index] ??= { current: value });
    },
    useState(value: unknown) {
      const index = cursor++;
      slots[index] ??= { value };
      return [slots[index].value, (next: unknown) => (slots[index].value = next)];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) {
        const previous = slots[index];
        slots[index] = { deps, effect };
        effects.push(() => {
          previous?.cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };
  const requests: {
    path: string;
    signal: AbortSignal;
    resolve: (value: unknown) => void;
  }[] = [];
  const api = (path: string, _body: unknown, _method: string, signal: AbortSignal) =>
    new Promise((resolve) => requests.push({ path, signal, resolve }));
  const output = ts.transpileModule(readFileSync('web/app/useCreatedPages.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText;
  const exports: any = {};
  new Function('require', 'exports', output)(
    (name: string) => (name === 'react' ? react : { api }),
    exports,
  );
  return {
    requests,
    render(workspaceId: string | null) {
      cursor = 0;
      const result = exports.default(workspaceId);
      const queued = effects;
      effects = [];
      queued.forEach((effect) => effect());
      return result as { pages: { id: string }[]; loading: boolean; reload: () => Promise<void> };
    },
    replayEffects() {
      // React StrictMode preserves refs/state but cleans up and re-runs mount effects.
      for (const slot of slots) {
        if (!slot.effect) continue;
        slot.cleanup?.();
        slot.cleanup = slot.effect();
      }
    },
    unmount() {
      for (const slot of slots) slot.cleanup?.();
    },
  };
}
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test('created pages reject stale workspace reloads before they invalidate active requests', async () => {
  const harness = createdPagesHarness();
  const oldReload = harness.render('old').reload;
  harness.render('new');
  assert.equal(harness.requests[0].signal.aborted, true);
  await oldReload();
  assert.equal(
    harness.requests.length,
    2,
    'old reload must not issue another old-workspace request',
  );
  harness.requests[0].resolve({ pages: [{ id: 'stale', workspaceId: 'old' }] });
  harness.requests[1].resolve({
    pages: [
      { id: 'current', workspaceId: 'new' },
      { id: 'foreign', workspaceId: 'old' },
    ],
  });
  await settle();
  assert.deepEqual(
    harness.render('new').pages.map((page) => page.id),
    ['current'],
  );
  assert.equal(harness.render('new').loading, false);
  harness.unmount();
});

test('created pages abort superseded requests, survive StrictMode replay and clear empty loading', async () => {
  const harness = createdPagesHarness();
  harness.render('space');
  harness.replayEffects();
  assert.equal(harness.requests[0].signal.aborted, true);
  assert.equal(harness.requests[1].signal.aborted, false);
  const reloading = harness.render('space').reload();
  assert.equal(harness.requests[1].signal.aborted, true);
  harness.render(null);
  assert.equal(harness.requests[2].signal.aborted, true);
  assert.equal(harness.render(null).loading, false);
  harness.requests.forEach((request) => request.resolve({ pages: [] }));
  await reloading;
  assert.deepEqual(harness.render(null).pages, []);
  harness.render('space');
  const reload = harness.render('space').reload;
  harness.unmount();
  assert.equal(harness.requests.at(-1)?.signal.aborted, true);
  const count = harness.requests.length;
  await reload();
  assert.equal(harness.requests.length, count, 'unmounted callbacks must not restart requests');
});

test('profile mutations never reset aggregate Provider dirty or busy guards', () => {
  const source = readFileSync('web/features/profile/ProfileView.tsx', 'utf8');
  const save = source.slice(source.indexOf('  async function save('), source.indexOf('  return ('));
  assert.doesNotMatch(save, /onDirtyChange\(false\)|onBusyChange\(false\)/);
  assert.match(source, /onDirtyChange\(dirty \|\| providerDirty\)/);
  assert.match(source, /onBusyChange\(working \|\| providerBusy\)/);
  assert.match(source, /event\.target\.value !== profile\.name \|\| providerDirty/);
});

test('workshop project modal owns initial focus, keyboard containment and trigger restoration', () => {
  const source = readFileSync('web/features/workshop/WorkshopProjectMenu.tsx', 'utf8');
  assert.match(source, /closeButton\.current\?\.focus\(\)/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /dialog\.contains\(document\.activeElement\)/);
  assert.match(source, /event\.shiftKey \? last : first/);
  assert.match(source, /trigger\.current\?\.focus\(\)/);
  assert.match(source, /removeEventListener\('keydown', key\)/);
  assert.match(source, /document\.body\.style\.overflow = overflow/);
  assert.match(source, /\}, \[open\]\)/, 'inline onClose must not reset focus on every render');
});
