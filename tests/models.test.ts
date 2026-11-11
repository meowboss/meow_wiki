import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelBroker } from '../src/models.ts';
const settings = {
  endpoint: 'https://model.example/v1',
  model: 'test-model',
  apiKey: 'test-only-secret',
};
const fake = (answer: string) =>
  (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }))) as typeof fetch;
const evidence = [{ label: 'S1', title: '来源', excerpt: '猫喜欢阳光' }];
test('broker validates host endpoints and rejects user credentials in URLs', () => {
  assert.throws(() => new ModelBroker({ ...settings, endpoint: 'http://evil.invalid/v1' }));
  assert.throws(
    () => new ModelBroker({ ...settings, endpoint: 'https://user:pass@model.example' }),
  );
  assert.doesNotThrow(
    () => new ModelBroker({ ...settings, endpoint: 'http://localhost:8000/v1', allowLocal: true }),
  );
});
test('broker enforces bounded context, secret-only header, no redirects and known citations', async () => {
  const broker = new ModelBroker(settings, (async (url, init) => {
    assert.equal(String(url), 'https://model.example/v1/chat/completions');
    assert.equal(init?.redirect, 'error');
    const body = String(init?.body);
    assert.ok(body.length < 15_000);
    assert.ok(!body.includes(settings.apiKey));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '根据资料，猫喜欢阳光[S1]。' } }] }),
    );
  }) as typeof fetch);
  assert.match(await broker.generate('猫？', evidence), /\[S1\]/);
  await assert.rejects(
    new ModelBroker(settings, fake('假引用[S2]')).generate('猫？', evidence),
    /有效来源/,
  );
  await assert.rejects(
    new ModelBroker(settings, fake('没有引用')).generate('猫？', evidence),
    /有效来源/,
  );
});
test('provider errors and malformed responses are sanitized without secret leakage', async () => {
  const failed = new ModelBroker(settings, (async () => {
    throw new Error(settings.apiKey);
  }) as typeof fetch);
  await assert.rejects(
    failed.generate('猫', evidence),
    (error) => error instanceof Error && !error.message.includes(settings.apiKey),
  );
  await assert.rejects(
    new ModelBroker(
      settings,
      (async () => new Response('bad', { status: 429 })) as typeof fetch,
    ).generate('猫', evidence),
    /拒绝/,
  );
});
