import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { createBackup } from '../src/backup.ts';
test('online backup produces independently readable content and refuses overwrite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'meow-backup-'));
  const original = join(directory, 'original.sqlite'),
    destination = join(directory, 'backup.sqlite');
  const store = new Store(original);
  let recovered: Store | undefined;
  try {
    const id = store.ensure('owner');
    const page = store.get('owner', id).pages[0];
    store.updatePage('owner', id, page.id, 1, { markdown: '可恢复内容' });
    await createBackup(original, destination);
    if (process.platform !== 'win32') assert.equal(statSync(destination).mode & 0o777, 0o600);
    recovered = new Store(destination);
    assert.equal(recovered.get('owner', id).pages[0].markdown, '可恢复内容');
    assert.equal(recovered.history('owner', id, page.id).length, 2);
    const before = readFileSync(destination);
    await assert.rejects(createBackup(original, destination));
    assert.deepEqual(readFileSync(destination), before);
    await assert.rejects(createBackup(original, original));
  } finally {
    recovered?.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
