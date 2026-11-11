import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
import { DomainError, DomainsService } from '../src/modules/domains/service.ts';
import { McpCredentials } from '../src/modules/mcp/credentials.ts';

test('SDK HTTP client can only submit pending contributions with a live contribution grant', async () => {
  const store = new Store(':memory:');
  const app = createApp({ store, mode: 'session' });
  const clients: Client[] = [];
  try {
    const signup = async (name: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: 'http://localhost:3000' },
        payload: { email: `${name}@example.test`, name, password: 'mcp-password-123' },
      });
      assert.equal(response.statusCode, 200, response.body);
      const set = response.headers['set-cookie']!;
      const cookie = (Array.isArray(set) ? set : [set])
        .map((value) => value.split(';')[0])
        .join('; ');
      const me = (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json();
      return {
        id: me.user.id as string,
        headers: { cookie, 'x-csrf-token': me.csrfToken as string },
      };
    };
    const owner = await signup('owner');
    const contributor = await signup('contributor');
    const reader = await signup('reader');
    const domains = new DomainsService(store.db);
    const domain = domains.create(owner.id, store.ensure(owner.id), { name: 'SDK writes' });
    domains.setMember(owner.id, domain.id, { userId: contributor.id, role: 'contributor' });
    domains.setMember(owner.id, domain.id, { userId: reader.id, role: 'reader' });
    const issue = (headers: typeof owner.headers, scope?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/mcp/credentials',
        headers,
        payload: { domainId: domain.id, label: 'SDK', ...(scope === undefined ? {} : { scope }) },
      });
    const forbidden = await issue(reader.headers, 'domain.contribute');
    assert.equal(forbidden.statusCode, 403, forbidden.body);
    const invalid = await issue(owner.headers, 'domain.write');
    assert.equal(invalid.statusCode, 400, invalid.body);
    const credentials = new McpCredentials(store.db, domains);
    assert.deepEqual(credentials.list(reader.id), []);
    const writeIssued = await issue(contributor.headers, 'domain.contribute');
    assert.equal(writeIssued.statusCode, 201, writeIssued.body);
    const write = writeIssued.json();
    assert.equal(write.record.scope, 'domain.contribute');
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const connect = async (token: string) => {
      const client = new Client({ name: 'write-acceptance', version: '1' });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL('/mcp', address), {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
        }),
      );
      return client;
    };
    const client = await connect(write.token);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'domain_info',
      'read_contribution',
      'search_knowledge',
      'submit_contribution',
    ]);
    assert.equal(
      tools.find((tool) => tool.name === 'submit_contribution')!.annotations?.readOnlyHint,
      false,
    );
    const input = { title: 'SDK draft', content: 'Must remain pending', expectedDomainRevision: 1 };
    const result = await client.callTool({ name: 'submit_contribution', arguments: input });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.ok(Array.isArray(result.content));
    const text = result.content.find((item) => item.type === 'text');
    assert.ok(text && text.type === 'text');
    const submitted = JSON.parse(text.text);
    assert.equal(submitted.status, 'pending');
    assert.equal(submitted.authorId, contributor.id);
    assert.equal(submitted.domainId, domain.id);
    assert.equal(submitted.reviewerId, null);
    assert.deepEqual(
      domains.contributions(owner.id, domain.id).map((row) => ({ ...row })),
      [submitted],
    );
    assert.equal(domains.get(owner.id, domain.id).revision, 1);
    assert.deepEqual(domains.search(reader.id, domain.id, 'SDK'), []);
    const hidden = await client.callTool({
      name: 'read_contribution',
      arguments: { id: submitted.id },
    });
    assert.equal(hidden.isError, true);
    for (const name of ['review_contribution', 'publish_contribution']) {
      const denied = await client.callTool({
        name,
        arguments: { id: submitted.id, decision: 'published' },
      });
      assert.equal(denied.isError, true);
    }
    // Even after gaining maintenance authority the original author cannot self-publish.
    domains.setMember(owner.id, domain.id, { userId: contributor.id, role: 'maintainer' });
    assert.throws(
      () => domains.review(contributor.id, domain.id, submitted.id, { decision: 'published' }),
      (error: unknown) => error instanceof DomainError && error.statusCode === 403,
    );
    assert.equal(domains.contributions(owner.id, domain.id)[0].status, 'pending');
    for (const scope of [undefined, 'domain.read']) {
      const readIssued = await issue(contributor.headers, scope);
      assert.equal(readIssued.statusCode, 201, readIssued.body);
      assert.equal(readIssued.json().record.scope, 'domain.read');
      const readClient = await connect(readIssued.json().token);
      const readTools = (await readClient.listTools()).tools;
      assert.equal(readTools.length, 3);
      assert.ok(readTools.every((tool) => tool.annotations?.readOnlyHint === true));
      const denied = await readClient.callTool({ name: 'submit_contribution', arguments: input });
      assert.equal(denied.isError, true);
    }
    assert.equal(domains.contributions(owner.id, domain.id).length, 1);
    domains.setMember(owner.id, domain.id, { userId: contributor.id, role: 'reader' });
    assert.throws(
      () => credentials.authenticate(write.token),
      (error: unknown) => (error as { statusCode: number }).statusCode === 401,
    );
    // Reuse the already connected real SDK client: every request must reauthenticate.
    await assert.rejects(
      client.callTool({ name: 'submit_contribution', arguments: input }),
      (error: unknown) => error instanceof StreamableHTTPError && error.code === 401,
    );
    await assert.rejects(
      client.listTools(),
      (error: unknown) => error instanceof StreamableHTTPError && error.code === 401,
    );
    assert.equal(domains.contributions(owner.id, domain.id).length, 1);
    assert.equal(domains.get(owner.id, domain.id).revision, 1);
  } finally {
    for (const client of clients) await client.close();
    await app.close();
    store.close();
  }
});
