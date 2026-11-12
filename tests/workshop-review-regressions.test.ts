import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { AssetService } from '../src/modules/assets/service.ts';
import { CompositionService } from '../src/modules/compositions/service.ts';
import { WorkshopCreatedPages } from '../src/modules/workshop/created-pages.ts';
import { validation } from '../src/modules/workshop/page-projects.ts';
import { createDefaultComposition } from '../packages/canvas-contract/index.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'meow-reference-review-'));
  const path = join(directory, 'content.sqlite');
  const store = new Store(path);
  const workspace = store.ensure('owner');
  const peer = new Store(path);
  const authorize = (owner: string, id: string) => {
    store.get(owner, id);
  };
  const peerAuthorize = (owner: string, id: string) => {
    peer.get(owner, id);
  };
  const assets = new AssetService(store.db, authorize);
  const peerAssets = new AssetService(peer.db, peerAuthorize);
  const compositions = new CompositionService(store.db, authorize);
  const peerCompositions = new CompositionService(peer.db, peerAuthorize);
  const asset = assets.create('owner', workspace, {
    name: 'pixel',
    mime: 'image/png',
    base64: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64'),
  });
  const { revision: _, ...document } = createDefaultComposition('home');
  document.instances = [
    {
      ...document.instances[0],
      id: 'image',
      viewId: 'builtin.image',
      config: { assetId: asset.id },
    },
  ];
  return {
    store,
    peer,
    workspace,
    assets,
    peerAssets,
    compositions,
    peerCompositions,
    asset,
    document,
    close() {
      peer.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

for (const kind of ['composition', 'created-page'] as const) {
  test(`${kind} snapshot and referenced asset deletion cannot both commit`, () => {
    const f = fixture();
    try {
      const validate = f.compositions.validateReferences.bind(f.compositions);
      let deleted = false;
      const checked = (
        owner: string,
        workspace: string,
        document: Parameters<typeof validate>[2],
      ) => {
        validate(owner, workspace, document);
        try {
          f.peerAssets.remove(owner, workspace, f.asset.id);
          deleted = true;
        } catch (error) {
          assert.match(String(error), /locked|busy/i);
        }
      };
      const save = () => {
        if (kind === 'composition') {
          f.compositions.validateReferences = checked;
          f.compositions.update('owner', f.workspace, 'home', {
            expectedRevision: 0,
            composition: f.document,
          });
        } else {
          const pages = new WorkshopCreatedPages(
            f.store.db,
            (owner, workspace) => {
              f.store.get(owner, workspace);
            },
            checked,
          );
          pages.create('owner', f.workspace, { title: 'Page', composition: f.document });
        }
      };
      let saved = false;
      try {
        save();
        saved = true;
      } catch (error) {
        assert.match(String(error), /locked|busy|storage operation failed/i);
      }
      assert.notEqual(saved, deleted, 'must not commit a snapshot referencing a deleted asset');
      if (saved) {
        assert.equal(f.assets.get('owner', f.workspace, f.asset.id).id, f.asset.id);
        assert.throws(() => f.assets.remove('owner', f.workspace, f.asset.id), /仍被/);
      } else {
        assert.equal(f.compositions.get('owner', f.workspace, 'home').revision, 0);
      }
    } finally {
      f.close();
    }
  });
}

test('asset reference scan and deletion cannot interleave with a composition save', () => {
  const f = fixture();
  const prepare = f.store.db.prepare.bind(f.store.db);
  let saved = false;
  try {
    // Interleave immediately after scanning saved compositions but before DELETE.
    f.store.db.prepare = ((sql: string) => {
      const statement = prepare(sql);
      if (sql === 'SELECT json FROM mw_compositions WHERE owner=?') {
        const all = statement.all.bind(statement);
        statement.all = ((...parameters: Parameters<typeof all>) => {
          const rows = all(...parameters);
          try {
            f.peerCompositions.update('owner', f.workspace, 'home', {
              expectedRevision: 0,
              composition: f.document,
            });
            saved = true;
          } catch (error) {
            assert.match(String(error), /locked|busy/i);
          }
          return rows;
        }) as typeof statement.all;
      }
      return statement;
    }) as typeof f.store.db.prepare;
    let deleted = false;
    try {
      f.assets.remove('owner', f.workspace, f.asset.id);
      deleted = true;
    } catch (error) {
      assert.match(String(error), /locked|busy/i);
    }
    assert.notEqual(saved, deleted, 'must not commit both the new reference and asset deletion');
    if (deleted) {
      assert.throws(() => f.assets.get('owner', f.workspace, f.asset.id));
      assert.equal(f.compositions.get('owner', f.workspace, 'home').revision, 0);
    } else {
      assert.equal(f.assets.get('owner', f.workspace, f.asset.id).id, f.asset.id);
      assert.equal(f.compositions.get('owner', f.workspace, 'home').revision, 1);
    }
  } finally {
    f.store.db.prepare = prepare;
    f.close();
  }
});

test('component validation diagnostics have the same bounded budget as page diagnostics', () => {
  const content = JSON.stringify({
    name: 'Invalid',
    description: '',
    template: '',
    blocks: Array(20).fill({ type: 'markdown' }),
  });
  assert.ok(content.length < 30000);
  const result = validation(content);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.length > 0);
    assert.ok(result.issues.length <= 8);
    assert.ok(result.issues.every((issue) => issue.length <= 160));
  }
});
