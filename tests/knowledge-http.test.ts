import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
test('knowledge HTTP queues, processes, cites and retracts scoped sources; missing models fail honestly', async () => {
  const store = new Store(':memory:'); const app = createApp({ store });
  try {
    const source = (await app.inject({ method: 'POST', url: '/api/sources', payload: { title: '猫咪资料', content: '猫咪喜欢阳光，也需要清洁饮水。' } })).json();
    assert.equal(source.status, 'queued');
    const ask = () => app.inject({ method: 'POST', url: '/api/knowledge/ask', payload: { question: '猫咪', mode: 'extractive' } });
    assert.equal((await ask()).json().sources.length, 0);
    assert.equal((await app.inject({ method: 'POST', url: `/api/sources/${source.id}/process` })).json().status, 'ready');
    assert.equal((await ask()).json().sources[0].revision, 1);
    assert.equal((await app.inject({ method: 'POST', url: '/api/knowledge/ask', payload: { question: '猫咪', mode: 'model' } })).statusCode, 409);
    const other = store.ensure('other');
    assert.equal((await app.inject(`/api/sources/${source.id}?workspaceId=${other}`)).statusCode, 404);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/sources/${source.id}` })).statusCode, 200);
    assert.equal((await ask()).json().sources.length, 0);
    assert.equal((await app.inject({ method: 'POST', url: `/api/sources/${source.id}/process` })).statusCode, 404);
  } finally { await app.close(); store.close(); }
});
