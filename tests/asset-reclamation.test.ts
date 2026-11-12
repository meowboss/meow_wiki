import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { AssetService } from '../src/modules/assets/service.ts';
import { CompositionService } from '../src/modules/compositions/service.ts';
import { createDefaultComposition } from '../packages/canvas-contract/index.ts';
test('unused assets release quota while saved compositions protect referenced media', () => {
  const store = new Store(':memory:');
  try {
    const authorize = (owner: string, workspace: string) => {
      store.get(owner, workspace);
    };
    const assets = new AssetService(store.db, authorize),
      compositions = new CompositionService(store.db, authorize);
    const workspace = store.ensure('owner');
    const value = {
      name: 'pixel',
      mime: 'image/png',
      base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]).toString('base64'),
    };
    const unused = assets.create('owner', workspace, value);
    assets.remove('owner', workspace, unused.id);
    assert.throws(() => assets.get('owner', workspace, unused.id));
    const media = assets.create('owner', workspace, value);
    const { revision, ...doc } = createDefaultComposition('wiki');
    doc.instances.push({
      ...doc.instances[0],
      id: 'image',
      viewId: 'builtin.image',
      config: { assetId: media.id },
    });
    compositions.update('owner', workspace, 'wiki', {
      expectedRevision: revision,
      composition: doc,
    });
    assert.throws(() => assets.remove('owner', workspace, media.id), /仍被/);
  } finally {
    store.close();
  }
});
