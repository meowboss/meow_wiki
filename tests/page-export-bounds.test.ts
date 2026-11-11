import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { PageTransfer } from '../src/modules/pages/transfer.ts';
test('export refuses to produce a page package that its importer cannot consume', () => {
  const store = new Store(':memory:');
  try {
    const id = store.ensure('owner');
    const transfer = new PageTransfer(store);
    const one = transfer.export('owner', id);
    transfer.import('owner', id, {
      ...one,
      pages: Array.from({ length: 99 }, (_, i) => ({
        id: `source-${i}`,
        title: `page${i}`,
        markdown: '',
        parentId: null,
      })),
    });
    assert.throws(() => transfer.export('owner', id), /可恢复边界/);
  } finally {
    store.close();
  }
});
