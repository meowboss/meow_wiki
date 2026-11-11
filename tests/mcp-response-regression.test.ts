import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Store } from '../src/store.ts';
import { DomainsService } from '../src/modules/domains/service.ts';
import { createDomainMcp } from '../src/modules/mcp/server.ts';
test('large published domains return bounded summaries and cursor pages instead of entire corpus', async () => {
  const store = new Store(':memory:');
  let client: Client | undefined;
  let server: ReturnType<typeof createDomainMcp> | undefined;
  try {
    store.db.exec(
      "CREATE TABLE user(id TEXT PRIMARY KEY,email TEXT,name TEXT);INSERT INTO user VALUES('owner','o@t.invalid','O'),('writer','w@t.invalid','W')",
    );
    const domains = new DomainsService(store.db);
    const domain = domains.create('owner', store.ensure('owner'), { name: '大域' });
    domains.setMember('owner', domain.id, { userId: 'writer', role: 'contributor' });
    for (let i = 1; i <= 25; i++) {
      const source = domains.submit('writer', domain.id, {
        title: `source${i}`,
        content: 'x'.repeat(100000),
        expectedDomainRevision: i,
      });
      domains.review('owner', domain.id, source.id, { decision: 'published' });
    }
    server = createDomainMcp(domains, {
      userId: 'writer',
      domainId: domain.id,
      credentialId: 'test',
    });
    client = new Client({ name: 'regression', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    const response = await client.readResource({ uri: `meow://domains/${domain.id}` });
    assert.ok(JSON.stringify(response).length < 60000);
    assert.ok('text' in response.contents[0]);
    const data = JSON.parse(String(response.contents[0].text));
    assert.equal(data.items.length, 20);
    const next = await client.callTool({
      name: 'list_publications',
      arguments: { after: data.nextCursor },
    });
    const items = JSON.parse(String((next.content as { text: string }[])[0].text)).items;
    assert.equal(items.length, 5);
    const full = await client.callTool({
      name: 'read_contribution',
      arguments: { id: data.items[0].id },
    });
    assert.ok(JSON.stringify(full).length > 100000);
  } finally {
    await client?.close();
    await server?.close();
    store.close();
  }
});
