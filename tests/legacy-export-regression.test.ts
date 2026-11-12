import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { PageTransfer } from '../src/modules/pages/transfer.ts';
test('legacy live child of a tombstoned parent exports as root without mutating source', () => {
  const store = new Store(':memory:');
  try {
    const wid = store.ensure('owner');
    const [parent, child] = store.get('owner', wid).pages;
    store.change('owner', wid, (w) => {
      w.pages[0] = { ...parent, revision: 2, deletedAt: new Date().toISOString() };
      w.pages[1] = { ...child, revision: 2, parentId: parent.id };
    });
    const transfer = new PageTransfer(store);
    const bundle = transfer.export('owner', wid);
    assert.equal(bundle.pages.length, 1);
    assert.equal(bundle.pages[0].parentId, null);
    assert.equal(store.get('owner', wid).pages[1].parentId, parent.id);
    const target = store.create('owner', '目标');
    assert.equal(transfer.import('owner', target, bundle).imported, 1);
  } finally {
    store.close();
  }
});
