import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CANVAS_SESSION_MAX_NUMBER,
  CanvasInstanceSessionProvider,
  CanvasInstanceSessionScopeProvider,
  CanvasInstanceSessionStore,
  resolveCanvasInstanceSessionScope,
  useInstanceSessionState,
} from '../web/shared/canvas-instance-session.tsx';
import CanvasDirectoryView from '../web/shared/components/CanvasDirectoryView.tsx';

// Entirely synthetic, in-memory document; no account/API/session fixtures or real data.
const newTestSessionDocument = () => ({
  identity: { ownerId: 'test-owner', workspaceId: 'test-workspace', surface: 'test-surface' },
  instances: ['directory-test', 'pet-test'],
});

test('surface store keeps exact query/pet scalars across leaf remounts, isolated by instance', () => {
  const store = new CanvasInstanceSessionStore();
  store.set('directory-test', 'directory.query', 'test needle');
  store.set('pet-test', 'pet.paused', true);
  store.set('pet-test', 'pet.greetings', 3);
  assert.equal(store.getOrInitialize('directory-test', 'directory.query', ''), 'test needle');
  assert.equal(store.getOrInitialize('other-directory', 'directory.query', ''), '');
  assert.equal(store.getOrInitialize('pet-test', 'pet.paused', false), true);
  assert.equal(store.getOrInitialize('pet-test', 'pet.greetings', 0), 3);
  // Same ID reparenting does not delete; actual removal and re-add start fresh.
  store.retain(['directory-test', 'pet-test']);
  assert.equal(store.getOrInitialize('pet-test', 'pet.greetings', 0), 3);
  store.retain(['directory-test']);
  assert.equal(store.getOrInitialize('pet-test', 'pet.greetings', 0), 0);
});

test('owner/workspace/surface identity resets immediately and collision-free', () => {
  const { identity } = newTestSessionDocument();
  const original = resolveCanvasInstanceSessionScope(null, identity);
  original.store.set('pet-test', 'pet.paused', true);
  assert.equal(resolveCanvasInstanceSessionScope(original, { ...identity }), original);
  for (const key of ['ownerId', 'workspaceId', 'surface'] as const) {
    const next = resolveCanvasInstanceSessionScope(original, { ...identity, [key]: 'other' });
    assert.notEqual(next.store, original.store);
    assert.equal(next.store.getOrInitialize('pet-test', 'pet.paused', false), false);
  }
  assert.notEqual(
    resolveCanvasInstanceSessionScope(null, { ownerId: 'a:b', workspaceId: 'c', surface: 'd' })
      .scope,
    resolveCanvasInstanceSessionScope(null, { ownerId: 'a', workspaceId: 'b:c', surface: 'd' })
      .scope,
  );
});

test('store is bounded to 40 instances and three validated primitive fields', () => {
  const store = new CanvasInstanceSessionStore();
  assert.equal(store.set('query', 'directory.query', 'q'.repeat(6000)), true);
  assert.equal(store.getOrInitialize('query', 'directory.query', '').length, 5000);
  store.set('query', 'pet.greetings', 1.9);
  assert.equal(store.getOrInitialize('query', 'pet.greetings', 0), 1);
  store.set('query', 'pet.greetings', -2);
  assert.equal(store.getOrInitialize('query', 'pet.greetings', 0), 0);
  store.set('query', 'pet.greetings', 1e20);
  assert.equal(store.getOrInitialize('query', 'pet.greetings', 0), CANVAS_SESSION_MAX_NUMBER);
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => store.set('query', 'pet.greetings', value), TypeError);
  }
  assert.throws(() => store.set('query', 'unknown' as 'directory.query', 'test'), TypeError);
  assert.throws(() => store.set('query', 'directory.query', {} as string), TypeError);
  assert.throws(() => store.set('query', 'pet.paused', 1 as unknown as boolean), TypeError);
  for (let i = 1; i < 40; i++) store.set(`instance-${i}`, 'pet.paused', false);
  assert.equal(store.size, 40);
  assert.equal(store.set('overflow', 'pet.paused', true), false);
  assert.equal(store.set('x'.repeat(257), 'pet.paused', true), false);
  assert.equal(store.size, 40);
  store.retain([]);
  assert.equal(store.size, 0);
});

test('SSR remount under different tree parents reads same synthetic surface session', () => {
  const { identity } = newTestSessionDocument();
  const session = resolveCanvasInstanceSessionScope(null, identity);
  session.store.set('directory-test', 'directory.query', 'test needle');
  session.store.set('pet-test', 'pet.paused', true);
  session.store.set('pet-test', 'pet.greetings', 3);
  function PetState() {
    const [paused] = useInstanceSessionState('pet.paused', false);
    const [greetings] = useInstanceSessionState('pet.greetings', 0);
    return createElement('output', null, `${paused}:${greetings}`);
  }
  const render = (parent: 'section' | 'article') =>
    renderToStaticMarkup(
      createElement(
        CanvasInstanceSessionScopeProvider,
        { value: session },
        createElement(
          parent,
          null,
          createElement(CanvasInstanceSessionProvider, {
            instanceId: 'directory-test',
            children: createElement(CanvasDirectoryView, {
              pages: [],
              onOpen: () => {},
              config: {},
            }),
          }),
          createElement(CanvasInstanceSessionProvider, {
            instanceId: 'pet-test',
            children: createElement(PetState),
          }),
        ),
      ),
    );
  for (const parent of ['section', 'article'] as const) {
    const markup = render(parent);
    assert.match(markup, /value="test needle"/);
    assert.match(markup, /<output>true:3<\/output>/);
  }
  // A consumer outside any surface still renders with ordinary local initial state.
  assert.equal(renderToStaticMarkup(createElement(PetState)), '<output>false:0</output>');
});
