import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { KnowledgeService } from '../src/knowledge.ts';
import { Proposals } from '../src/proposals.ts';
test('confirmed evidence proposals are atomic, reject stale targets and withdrawn sources', () => {
  const store = new Store(':memory:');
  try {
    const w = store.ensure('alice'); const page = store.get('alice', w).pages[0];
    const knowledge = new KnowledgeService(store.db); const proposals = new Proposals(store.db, store, knowledge);
    const source = knowledge.create('alice', w, { title: '猫资料', content: '猫喜欢阳光' }); knowledge.run('alice', w, source.id);
    const hit = knowledge.search('alice', w, '猫')[0];
    const input = { pageId: page.id, expectedRevision: page.revision, title: '新标题', markdown: '猫喜欢阳光[S1]', evidence: [{ sourceId: source.id, revision: 1, chunkId: hit.chunkId }] };
    const rejected = proposals.create('alice', w, input); proposals.decide('alice', w, rejected.id, 'reject');
    assert.equal(store.get('alice', w).pages[0].revision, 1);
    const accepted = proposals.create('alice', w, input); proposals.decide('alice', w, accepted.id, 'accept');
    assert.equal(store.get('alice', w).pages[0].revision, 2); assert.equal(store.history('alice', w, page.id).length, 2);
    assert.throws(() => proposals.decide('alice', w, accepted.id, 'accept'));
    assert.throws(() => proposals.create('alice', w, input), /版本/);
    const pending = proposals.create('alice', w, { ...input, expectedRevision: 2 });
    knowledge.remove('alice', w, source.id);
    assert.throws(() => proposals.decide('alice', w, pending.id, 'accept'));
    assert.equal(proposals.list('alice', w).find(p => p.id === pending.id)?.status, 'pending');
    assert.throws(() => proposals.list('bob', w));
  } finally { store.close(); }
});
