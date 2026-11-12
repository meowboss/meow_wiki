import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  coreCanvasRegistrations,
  createCanvasRegistry,
  createSlotCanvasRegistration,
  defaultRegistry,
  registeredCanvasEntries,
  type CanvasRenderContext,
  type CanvasViewInstance,
  type CanvasViewRegistration,
} from '../web/app/canvas-registry';
import type { WorkspaceData } from '../web/shared/api';

const instance = (
  viewId: string,
  config: CanvasViewInstance['config'] = {},
): CanvasViewInstance => ({
  id: 'test-view',
  viewId,
  visible: true,
  layer: 'content',
  x: 0,
  y: 0,
  w: 6,
  h: 3,
  config,
  style: {},
});
const context: CanvasRenderContext = { slots: {}, onOpen: () => {} };
const data: WorkspaceData = {
  workspace: { id: 'workspace', name: 'Workspace', description: '' },
  pages: [
    {
      id: 'page',
      title: 'Registered directory page',
      markdown: '',
      updatedAt: '',
      revision: 1,
      deletedAt: null,
      parentId: null,
    },
  ],
  trash: [],
  plugins: [],
  components: [
    {
      id: 'component',
      name: 'Component',
      description: '',
      template: '',
      status: 'draft',
      authorId: 'owner',
      version: 1,
      blocks: [{ type: 'page-list', title: 'Registered component pages' }],
    },
  ],
  marketplace: [],
  installed: [],
};

test('trusted extension renders through the same registry call without App branches or DOM', () => {
  const opened: string[] = [];
  const ctx: CanvasRenderContext = { ...context, data, onOpen: (id) => opened.push(id) };
  const registry = createCanvasRegistry([
    ...coreCanvasRegistrations,
    {
      id: 'official.summary',
      surfaces: ['home'],
      render: (view, received) => {
        assert.equal(received, ctx);
        received.onOpen(received.data!.pages[0].id);
        return createElement('article', null, view.config.text, received.data!.workspace.name);
      },
    },
  ]);
  const html = renderToStaticMarkup(
    registry.render(instance('official.summary', { text: 'Trusted summary: ' }), ctx, 'home'),
  );
  assert.equal(html, '<article>Trusted summary: Workspace</article>');
  assert.deepEqual(opened, ['page']);
  assert.equal(defaultRegistry.get('official.summary'), undefined);
});

test('a new slot registration uses generic context lookup and renders without a view switch', () => {
  const registry = createCanvasRegistry([
    ...coreCanvasRegistrations,
    createSlotCanvasRegistration('official.activity', ['home']),
  ]);
  const ctx = {
    ...context,
    slots: { 'official.activity': createElement('aside', null, 'Trusted slot') },
  };
  assert.equal(
    renderToStaticMarkup(registry.render(instance('official.activity'), ctx, 'home')),
    '<aside>Trusted slot</aside>',
  );
  assert.match(
    renderToStaticMarkup(registry.render(instance('official.activity'), ctx, 'wiki')),
    /画布视图不可用/,
  );
  assert.equal(registry.render(instance('official.activity'), context), null);
});

test('registry rejects duplicate IDs and snapshots caller-owned registrations and surfaces', () => {
  const surfaces: NonNullable<CanvasViewRegistration['surfaces']>[number][] = ['home'];
  const registration = { id: 'official.immutable', surfaces, render: () => 'original' };
  const input: CanvasViewRegistration[] = [registration];
  const registry = createCanvasRegistry(input);
  registration.id = 'official.changed';
  registration.render = () => 'changed';
  surfaces.push('wiki');
  input.length = 0;
  assert.equal(registry.render(instance('official.immutable'), context, 'home'), 'original');
  assert.match(
    renderToStaticMarkup(registry.render(instance('official.immutable'), context, 'wiki')),
    /画布视图不可用/,
  );
  assert.equal(registry.get('official.changed'), undefined);
  assert.ok(Object.isFrozen(registry));
  assert.ok(Object.isFrozen(registry.registrations));
  assert.ok(Object.isFrozen(registry.get('official.immutable')));
  assert.ok(Object.isFrozen(registry.get('official.immutable')!.surfaces));
  assert.equal('set' in registry, false);
  assert.throws(
    () => createCanvasRegistry([coreCanvasRegistrations[0], coreCanvasRegistrations[0]]),
    /Duplicate canvas view registration: builtin.search/,
  );
});

test('unknown views are escaped placeholders and cannot invoke slots or document code', () => {
  let executed = false;
  const unknownId = '<script>untrusted()</script>';
  const ctx = {
    ...context,
    slots: {
      [unknownId]: createElement(() => {
        executed = true;
        return null;
      }),
    },
  };
  const unknown = instance(unknownId);
  Object.defineProperty(unknown, 'config', { get: () => assert.fail('Unknown config was read') });
  const html = renderToStaticMarkup(defaultRegistry.render(unknown, ctx));
  assert.match(html, /role="status"/);
  assert.match(html, /&lt;script&gt;untrusted\(\)&lt;\/script&gt;/);
  assert.equal(executed, false);
  assert.equal(defaultRegistry.get('toString'), undefined);
  assert.match(
    renderToStaticMarkup(defaultRegistry.render(instance('toString'), context)),
    /不可用/,
  );
});

test('default registrations render search, directory, component references and every core slot', () => {
  const ctx = { ...context, data };
  assert.match(
    renderToStaticMarkup(defaultRegistry.render(instance('builtin.search'), ctx)),
    /画布搜索笔记/,
  );
  assert.match(
    renderToStaticMarkup(
      defaultRegistry.render(instance('builtin.directory', { text: 'Directory title' }), ctx),
    ),
    /Directory title.*Registered directory page/,
  );
  assert.match(
    renderToStaticMarkup(
      defaultRegistry.render(instance('component.render', { componentId: 'component' }), ctx),
    ),
    /Registered component pages.*Registered directory page/,
  );
  assert.match(
    renderToStaticMarkup(defaultRegistry.render(instance('component.render'), context)),
    /当前空间数据未就绪/,
  );
  for (const registration of coreCanvasRegistrations.filter((view) => view.surfaces)) {
    const slotContext = {
      ...context,
      slots: { [registration.id]: createElement('span', null, registration.id) },
    };
    assert.equal(
      renderToStaticMarkup(
        defaultRegistry.render(instance(registration.id), slotContext, registration.surfaces![0]),
      ),
      `<span>${registration.id}</span>`,
    );
  }
  for (const id of ['builtin.text', 'builtin.image', 'builtin.video', 'builtin.pet']) {
    assert.equal(defaultRegistry.get(id), undefined);
  }
});

test('trusted renderer metadata enters the same surface catalog without an App branch', () => {
  const registry = createCanvasRegistry([
    ...coreCanvasRegistrations,
    {
      id: 'official.sample.card',
      title: 'Sample card',
      config: { text: 'sample' },
      surfaces: ['home'],
      render: () => null,
    },
  ]);
  assert.deepEqual(registeredCanvasEntries(registry, 'home'), [
    { label: 'Sample card', viewId: 'official.sample.card', config: { text: 'sample' } },
  ]);
  assert.deepEqual(registeredCanvasEntries(registry, 'wiki'), []);
});
