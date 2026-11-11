import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpBudget, boundedMcpText } from '../src/modules/mcp/budget.ts';
test('MCP request budgets enforce user concurrency, window and bounded response bytes', async () => {
  let now = 0;
  const budget = new McpBudget(() => now);
  const first = budget.enter('user')!,
    second = budget.enter('user')!;
  assert.equal(budget.enter('user'), null);
  first();
  second();
  for (let i = 2; i < 60; i++) {
    const release = budget.enter('user');
    assert.ok(release);
    release();
  }
  assert.equal(budget.enter('user'), null);
  assert.ok(budget.enter('other'));
  now = 60001;
  assert.ok(budget.enter('user'));
  assert.equal(await boundedMcpText(new Response('ok')), 'ok');
  await assert.rejects(boundedMcpText(new Response('x'.repeat(512001))), /预算/);
});
