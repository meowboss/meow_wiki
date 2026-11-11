import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDomainMcp } from '../src/modules/mcp/server.ts';
import { Store } from '../src/store.ts';
import { DomainsService } from '../src/modules/domains/service.ts';
test('official MCP client interoperates with readonly domain tools and never returns pending content', async () => {
  const store = new Store(':memory:');
  store.db.exec('CREATE TABLE user(id TEXT PRIMARY KEY,email TEXT,name TEXT)');
  store.db.prepare('INSERT INTO user VALUES(?,?,?)').run('owner', 'owner@example.test', 'Owner');
  store.db.prepare('INSERT INTO user VALUES(?,?,?)').run('reader', 'reader@example.test', 'Reader');
  const domains = new DomainsService(store.db);
  const domain = domains.create('owner', store.ensure('owner'), { name: '测试域' });
  domains.setMember('owner', domain.id, { userId: 'reader', role: 'reader' });
  const pending = domains.submit('owner', domain.id, {
    title: '未发布秘密',
    content: '不能暴露',
    expectedDomainRevision: 1,
  });
  const server = createDomainMcp(domains, {
    userId: 'reader',
    domainId: domain.id,
    credentialId: 'test',
  });
  const client = new Client({ name: 'acceptance-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 3);
    assert.ok(tools.tools.every((t) => t.annotations?.readOnlyHint));
    const result = await client.callTool({
      name: 'read_contribution',
      arguments: { id: pending.id },
    });
    assert.equal(result.isError, true);
    const resource = await client.readResource({ uri: `meow://domains/${domain.id}` });
    assert.doesNotMatch(JSON.stringify(resource), /未发布秘密|不能暴露/);
    domains.removeMember('owner', domain.id, 'reader');
    const denied = await client.callTool({ name: 'domain_info', arguments: {} });
    assert.equal(denied.isError, true);
  } finally {
    await client.close();
    await server.close();
    store.close();
  }
});
