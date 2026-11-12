import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { ProviderVault } from '../src/modules/workshop/providers.ts';
import { WorkshopProjects } from '../src/modules/workshop/projects.ts';
import { ConversationStore } from '../src/modules/workshop/conversation.ts';
import { WorkshopEngine } from '../src/modules/workshop/engine.ts';
import { createApp } from '../src/app.ts';

function setup() {
  const store = new Store(':memory:');
  store.db.exec(
    "CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('owner'),('foreign')",
  );
  const projects = new WorkshopProjects(store.db, new ComponentService(store.db));
  const conversation = new ConversationStore(store.db, projects);
  const vault = new ProviderVault(store.db, 'test-only-master-secret-at-least-32-characters', {
    mock: 'https://provider.example/v1',
  });
  const key = 'test-only-secret-123';
  const profile = vault.save('owner', {
    label: 'mock',
    endpointId: 'mock',
    model: 'mock',
    apiKey: key,
  });
  const project = projects.create('owner', store.ensure('owner'), {
    name: 'chat',
    instruction: '创建组件',
  });
  return { store, projects, conversation, vault, key, profile, project };
}
function response(action: unknown) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(action) } }] }),
  );
}

test('durable multi-turn clarification, modification and finish retain safe ordered tool events', async () => {
  const { store, projects, conversation, vault, profile, project } = setup();
  try {
    const actions = [
      { tool: 'ask_user', message: '标题是什么？' },
      { tool: 'read_file', path: '/sdk/README.md' },
      {
        tool: 'write_file',
        path: '/project/component.json',
        content: JSON.stringify({ name: '读书', description: '', template: '# 新标题' }),
      },
      { tool: 'validate_component' },
      { tool: 'finish', message: '已修改标题。' },
    ];
    const requests: { messages: { role: string; content: string }[] }[] = [];
    const engine = new WorkshopEngine(
      projects,
      vault,
      (async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return response(actions.shift());
      }) as typeof fetch,
      conversation,
    );
    const first = await engine.chat('owner', project.id, profile.id, '帮我创建');
    assert.equal(first.project.state, 'draft');
    assert.equal(first.messages.at(-1)?.content, '标题是什么？');
    const second = await engine.chat('owner', project.id, profile.id, '改为新标题');
    assert.equal(second.project.state, 'ready');
    assert.equal(second.messages.at(-1)?.content, '已修改标题。');
    assert.deepEqual(
      requests[1].messages.filter((row, index) => row.role !== 'system' && index !== 1),
      [
        { role: 'user', content: '帮我创建' },
        { role: 'assistant', content: '标题是什么？' },
        { role: 'user', content: '改为新标题' },
      ],
    );
    assert.match(requests[1].messages[1].content, /只读SDK/);
    const tools = second.messages.filter((row) => row.role === 'tool');
    assert.equal(tools.length, 10);
    assert.ok(tools.every((row) => row.runId && row.callId && typeof row.turn === 'number'));
    assert.equal(tools[2].callId, tools[3].callId);
    assert.notEqual(tools[0].runId, tools[2].runId);
    assert.deepEqual(
      tools.slice(2, 4).map((row) => [row.content, row.status]),
      [
        ['read_file', 'started'],
        ['read_file', 'completed'],
      ],
    );
    assert.ok(!JSON.stringify(tools).includes('Declarative'));
    assert.deepEqual(
      new ConversationStore(store.db, projects).list('owner', project.id),
      second.messages,
    );
    assert.throws(() => conversation.list('foreign', project.id));
    assert.throws(() =>
      conversation.append('foreign', project.id, { role: 'user', content: 'intrude' }),
    );
    await assert.rejects(engine.chat('foreign', project.id, profile.id, 'intrude'));
    assert.ok(second.messages.every((row, i) => row.sequence === i + 1));
  } finally {
    store.close();
  }
});

test('secret guards precede persistence and escaped model messages fail safely', async () => {
  const { store, projects, conversation, vault, key, profile, project } = setup();
  try {
    let calls = 0;
    const engine = new WorkshopEngine(
      projects,
      vault,
      (async () => {
        calls++;
        return response({
          tool: 'ask_user',
          message: JSON.stringify({ secret: key }).replaceAll(key, '\\u0074est-only-secret-123'),
        });
      }) as typeof fetch,
      conversation,
    );
    await assert.rejects(engine.chat('owner', project.id, profile.id, key), /凭据/);
    await assert.rejects(engine.chat('owner', project.id, 'missing', 'safe'));
    assert.deepEqual(conversation.list('owner', project.id), []);
    assert.equal(calls, 0);
    await assert.rejects(engine.chat('owner', project.id, profile.id, 'safe'), /敏感凭据/);
    const rows = conversation.list('owner', project.id);
    assert.equal(rows.at(-1)?.status, 'error');
    assert.ok(!JSON.stringify(rows).includes(key));
    assert.equal(rows.filter((row) => row.role === 'tool').length, 0);
    assert.equal(projects.get('owner', project.id).state, 'failed');
  } finally {
    store.close();
  }
});

test('running lock prevents duplicate messages across engines; cancellation persists safe assistant error', async () => {
  const { store, projects, conversation, vault, profile, project } = setup();
  try {
    let started!: () => void;
    const begun = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = ((_url, init) =>
      new Promise((_resolve, reject) => {
        started();
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('unsafe upstream details')),
          { once: true },
        );
      })) as typeof fetch;
    const engine = new WorkshopEngine(projects, vault, fetcher, conversation);
    const pending = engine.chat('owner', project.id, profile.id, 'first');
    await begun;
    const other = new WorkshopEngine(projects, vault, fetcher, conversation);
    await assert.rejects(other.chat('owner', project.id, profile.id, 'duplicate'));
    await assert.rejects(other.run('owner', project.id, profile.id));
    assert.equal(conversation.list('owner', project.id).length, 1);
    assert.throws(() => projects.writeFile('owner', project.id, '/project/component.json', '{}'));
    engine.cancel('owner', project.id);
    await assert.rejects(pending, /取消/);
    assert.equal(conversation.list('owner', project.id).at(-1)?.status, 'cancelled');
    assert.ok(!JSON.stringify(conversation.list('owner', project.id)).includes('unsafe'));
  } finally {
    store.close();
  }
});

test('conversation retains at most 200 messages and 256k bytes with monotonic sequences', () => {
  const { store, conversation, project } = setup();
  try {
    for (let i = 0; i < 210; i++)
      conversation.append('owner', project.id, { role: 'assistant', content: '中'.repeat(3000) });
    const rows = conversation.list('owner', project.id);
    assert.ok(rows.length <= 200);
    assert.ok(rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row)), 0) <= 256000);
    assert.equal(rows.at(-1)?.sequence, 210);
    assert.throws(() =>
      conversation.append('owner', project.id, { role: 'tool', content: 'raw tool output' }),
    );
  } finally {
    store.close();
  }
});

test('chat HTTP exposes real provider clarification and pollable execution events', async () => {
  const store = new Store(':memory:');
  store.db.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('local-owner')");
  let finish!: (value: Response) => void;
  let started!: () => void;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  let providerCalls = 0;
  const app = createApp({
    store,
    workshop: {
      masterSecret: 'test-only-master-secret-at-least-32-characters',
      allowedEndpoints: { mock: 'https://provider.example/v1' },
      fetcher: (async () => {
        providerCalls++;
        if (providerCalls === 1) return response({ tool: 'read_file', path: '/sdk/README.md' });
        started();
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }) as typeof fetch,
    },
  });
  try {
    const provider = new ProviderVault(store.db, 'test-only-master-secret-at-least-32-characters', {
      mock: 'https://provider.example/v1',
    }).save('local-owner', {
      label: 'mock',
      endpointId: 'mock',
      model: 'mock',
      apiKey: 'fake-provider-secret',
    });
    const project = (
      await app.inject({
        method: 'POST',
        url: '/api/workshop/projects',
        payload: { name: 'chat', instruction: 'test' },
      })
    ).json();
    const pending = app.inject({
      method: 'POST',
      url: `/api/workshop/projects/${project.id}/chat`,
      payload: { providerId: provider.id, message: 'hello' },
    });
    const completed = pending.then((value) => value);
    await begun;
    const during = await app.inject(`/api/workshop/projects/${project.id}/messages`);
    assert.equal(during.statusCode, 200);
    assert.equal(during.json().messages[0].content, 'hello');
    assert.deepEqual(
      during
        .json()
        .messages.slice(1)
        .map((row: { content: string; status: string }) => [row.content, row.status]),
      [
        ['read_file', 'started'],
        ['read_file', 'completed'],
      ],
    );
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/workshop/projects/${project.id}/chat`,
      payload: { providerId: provider.id, message: 'duplicate' },
    });
    assert.equal(duplicate.statusCode, 409);
    finish(response({ tool: 'ask_user', message: '想要什么颜色？' }));
    const result = await completed;
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().project.state, 'draft');
    assert.equal(result.json().messages.at(-1).content, '想要什么颜色？');
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/workshop/projects/${project.id}/chat`,
          payload: { providerId: provider.id, message: 'x'.repeat(3001) },
        })
      ).statusCode,
      400,
    );
    assert.equal((await app.inject('/api/workshop/projects/missing/messages')).statusCode, 404);
    const foreign = createApp({ store, userId: 'foreign-owner' });
    try {
      assert.equal(
        (await foreign.inject(`/api/workshop/projects/${project.id}/messages`)).statusCode,
        404,
      );
      assert.equal(
        (
          await foreign.inject({
            method: 'POST',
            url: `/api/workshop/projects/${project.id}/chat`,
            payload: { providerId: provider.id, message: 'intrude' },
          })
        ).statusCode,
        404,
      );
    } finally {
      await foreign.close();
    }
  } finally {
    await app.close();
    store.close();
  }
});
