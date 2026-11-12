import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { DomainsService } from '../src/modules/domains/service.ts';
import { createDomainMcp } from '../src/modules/mcp/server.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Proposals } from '../src/proposals.ts';
import { KnowledgeService } from '../src/knowledge.ts';
test('MCP write receipts stay small for escaped content and never report budget failure after commit', async () => {
  const store = new Store(':memory:');
  let server: ReturnType<typeof createDomainMcp> | undefined;
  let client: Client | undefined;
  try {
    store.db.exec(
      "CREATE TABLE user(id TEXT PRIMARY KEY,email TEXT,name TEXT);INSERT INTO user VALUES('owner','o@t.invalid','O')",
    );
    const domains = new DomainsService(store.db);
    const domain = domains.create('owner', store.ensure('owner'), { name: 'receipt' });
    server = createDomainMcp(domains, {
      userId: 'owner',
      domainId: domain.id,
      credentialId: 'test',
      scope: 'domain.contribute',
    });
    client = new Client({ name: 'regression', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    const result = await client.callTool({
      name: 'submit_contribution',
      arguments: { title: 'escaped', content: '\0'.repeat(100000), expectedDomainRevision: 1 },
    });
    assert.notEqual(result.isError, true);
    assert.ok(JSON.stringify(result).length < 2000);
    assert.equal(domains.contributions('owner', domain.id).length, 1);
  } finally {
    await client?.close();
    await server?.close();
    store.close();
  }
});
test('all permitted proposals remain discoverable with old pending first', () => {
  const store = new Store(':memory:');
  try {
    const wid = store.ensure('owner'),
      page = store.get('owner', wid).pages[0],
      knowledge = new KnowledgeService(store.db),
      service = new Proposals(store.db, store, knowledge);
    const source = knowledge.create('owner', wid, { title: 'source', content: 'evidence' });
    knowledge.run('owner', wid, source.id);
    const hit = knowledge.search('owner', wid, 'evidence')[0];
    const input = {
      pageId: page.id,
      expectedRevision: 1,
      title: 'proposal',
      markdown: 'content',
      evidence: [{ sourceId: source.id, revision: 1, chunkId: hit.chunkId }],
    };
    const first = service.create('owner', wid, input);
    for (let i = 0; i < 100; i++) {
      const p = service.create('owner', wid, input);
      service.decide('owner', wid, p.id, 'reject');
    }
    const list = service.list('owner', wid);
    assert.equal(list.length, 101);
    assert.equal(list[0].id, first.id);
    assert.equal(list[0].status, 'pending');
  } finally {
    store.close();
  }
});
