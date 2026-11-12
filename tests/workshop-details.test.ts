import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ComponentService } from '../src/components.ts';
import { ProviderVault } from '../src/modules/workshop/providers.ts';
import { WorkshopProjects } from '../src/modules/workshop/projects.ts';
import {
  ConversationStore,
  type ConversationDetails,
} from '../src/modules/workshop/conversation.ts';
import { WorkshopEngine } from '../src/modules/workshop/engine.ts';

function setup(legacy = false) {
  const store = new Store(':memory:');
  store.db.exec(
    "CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('owner'),('foreign')",
  );
  const projects = new WorkshopProjects(store.db, new ComponentService(store.db));
  const project = projects.create('owner', store.ensure('owner'), {
    name: 'details',
    instruction: '创建组件',
  });
  if (legacy) {
    store.db.exec(`CREATE TABLE mw_workshop_messages (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      status TEXT, created_at TEXT NOT NULL, sequence INTEGER NOT NULL, UNIQUE(project_id,sequence))`);
    store.db
      .prepare('INSERT INTO mw_workshop_messages VALUES (?,?,?,?,?,?,?)')
      .run('legacy', project.id, 'user', 'old message', null, '2026-01-01', 1);
  }
  const conversation = new ConversationStore(store.db, projects);
  const vault = new ProviderVault(store.db, 'test-only-master-secret-at-least-32-characters', {
    mock: 'https://provider.example/v1',
  });
  const key = 'sk-details-test-secret';
  const profile = vault.save('owner', {
    label: 'mock',
    endpointId: 'mock',
    model: 'mock',
    apiKey: key,
  });
  const engine = (actions: unknown[]) =>
    new WorkshopEngine(
      projects,
      vault,
      (async () => {
        assert.ok(actions.length, 'unexpected provider round');
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(actions.shift()) } }] }),
        );
      }) as typeof fetch,
      conversation,
    );
  return { store, projects, project, conversation, key, profile, engine };
}

test('fixed provider loop records real bounded details and paired owner-scoped events without raw IO', async () => {
  const f = setup();
  try {
    const content = JSON.stringify(
      { name: '私有名称', description: '', template: '不可保存的文件内容\n第二行' },
      null,
      2,
    );
    const actions = [
      { tool: 'read_file', path: '/sdk/README.md' },
      { tool: 'read_file', path: '/sdk/component.schema.json' },
      { tool: 'write_file', path: '/project/component.json', content },
      { tool: 'read_file', path: '/project/component.json' },
      { tool: 'validate_component' },
      { tool: 'finish', message: '完成' },
    ];
    const result = await f.engine(actions).chat('owner', f.project.id, f.profile.id, '开始');
    assert.equal(result.project.state, 'ready');
    assert.equal(actions.length, 0);
    const tools = result.messages.filter((row) => row.role === 'tool');
    assert.equal(tools.length, 12);
    for (let i = 0; i < tools.length; i += 2) {
      const [start, complete] = tools.slice(i, i + 2);
      assert.equal(start.status, 'started');
      assert.equal(complete.status, 'completed');
      assert.equal(start.callId, complete.callId);
      assert.equal(start.runId, complete.runId);
      assert.equal(start.turn, complete.turn);
      assert.ok(complete.details!.durationMs! >= 0 && complete.details!.durationMs! <= 300000);
    }
    assert.equal(new Set(tools.map((row) => row.callId)).size, 6);
    assert.deepEqual(tools[0].details, { path: '/sdk/README.md' });
    const sdk = f.projects.readFile('owner', f.project.id, '/sdk/README.md');
    assert.equal(tools[1].details?.bytes, Buffer.byteLength(sdk));
    assert.equal(tools[1].details?.lines, sdk.split('\n').length);
    assert.deepEqual(tools[4].details, {
      path: '/project/component.json',
      bytes: Buffer.byteLength(content),
      lines: content.split('\n').length,
    });
    assert.equal(tools[7].details?.bytes, Buffer.byteLength(content));
    assert.equal(tools[9].details?.valid, true);
    assert.equal(tools[11].details?.valid, true);
    assert.equal(tools[11].details?.summary, '组件已通过验证，等待确认导入');
    assert.ok(!JSON.stringify(tools).includes('不可保存的文件内容'));
    assert.ok(!JSON.stringify(tools).includes('Declarative'));
    assert.ok(!JSON.stringify(tools).includes(f.key));
    assert.deepEqual(
      new ConversationStore(f.store.db, f.projects).list('owner', f.project.id),
      result.messages,
    );
    assert.throws(() => f.conversation.list('foreign', f.project.id));
    assert.throws(() =>
      f.conversation.append('foreign', f.project.id, {
        role: 'tool',
        content: 'finish',
        details: { valid: true },
      }),
    );
  } finally {
    f.store.close();
  }
});

test('legacy migration is additive and damaged or unknown details are omitted safely', () => {
  const f = setup(true);
  try {
    assert.equal(f.conversation.list('owner', f.project.id)[0].content, 'old message');
    assert.equal(f.conversation.list('owner', f.project.id)[0].details, undefined);
    assert.ok(
      f.store.db
        .prepare('PRAGMA table_info(mw_workshop_messages)')
        .all()
        .some((row) => row.name === 'details_json'),
    );
    const row = f.conversation.append('owner', f.project.id, {
      role: 'tool',
      content: 'finish',
      details: { valid: true },
    });
    for (const damaged of [
      '{',
      'null',
      '[]',
      '{"unknown":"raw"}',
      '{"bytes":-1}',
      '{"path":"/etc/passwd"}',
    ]) {
      f.store.db
        .prepare('UPDATE mw_workshop_messages SET details_json=? WHERE id=?')
        .run(damaged, row.id);
      assert.equal(f.conversation.list('owner', f.project.id).at(-1)?.details, undefined);
    }
    new ConversationStore(f.store.db, f.projects);
    assert.equal(f.conversation.list('owner', f.project.id).length, 2);
  } finally {
    f.store.close();
  }
});

test('append rejects illegal detail fields, bounds, non-tools and raw tool names', () => {
  const f = setup();
  try {
    const invalid = [
      { path: '/etc/passwd' },
      { bytes: -1 },
      { bytes: 128001 },
      { bytes: 1.5 },
      { lines: 30002 },
      { lines: -1 },
      { durationMs: 300001 },
      { durationMs: -1 },
      { valid: 'true' },
      { issues: Array(9).fill('issue') },
      { issues: ['x'.repeat(161)] },
      { summary: 'x'.repeat(301) },
      { content: 'raw file' },
      { response: 'raw model' },
    ];
    for (const details of invalid)
      assert.throws(() =>
        f.conversation.append('owner', f.project.id, {
          role: 'tool',
          content: 'read_file',
          details: details as ConversationDetails,
        }),
      );
    assert.throws(() =>
      f.conversation.append('owner', f.project.id, {
        role: 'assistant',
        content: 'x',
        details: {},
      }),
    );
    assert.throws(() =>
      f.conversation.append('owner', f.project.id, {
        role: 'tool',
        content: 'raw response',
        details: {},
      }),
    );
    assert.deepEqual(f.conversation.list('owner', f.project.id), []);
    f.conversation.append('owner', f.project.id, {
      role: 'tool',
      content: 'finish',
      details: {
        bytes: 128000,
        lines: 30001,
        durationMs: 300000,
        issues: Array(8).fill('x'.repeat(160)),
        summary: 'x'.repeat(300),
      },
    });
  } finally {
    f.store.close();
  }
});

test('schema validation issues are bounded and failure details omit hostile paths and raw errors', async () => {
  const f = setup();
  try {
    const content = JSON.stringify({
      name: 'x',
      description: '',
      template: '',
      blocks: Array(20).fill({ type: 'search', title: 123 }),
    });
    await f
      .engine([
        { tool: 'write_file', path: '/project/component.json', content },
        { tool: 'validate_component' },
        { tool: 'ask_user', message: '请修改' },
      ])
      .run('owner', f.project.id, f.profile.id);
    const details = f.conversation
      .list('owner', f.project.id)
      .find((row) => row.content === 'validate_component' && row.status === 'completed')!.details!;
    assert.equal(details.valid, false);
    assert.equal(details.issues?.length, 8);
    assert.ok(details.issues?.every((issue) => issue.length <= 160 && !issue.includes('123')));
    await assert.rejects(
      f
        .engine([{ tool: 'read_file', path: '/host/private-file' }])
        .run('owner', f.project.id, f.profile.id),
    );
    const rows = f.conversation.list('owner', f.project.id);
    const failed = rows.findLast((row) => row.status === 'failed')!;
    assert.equal(failed.details?.summary, '工具执行失败，已停止');
    assert.equal(rows.findLast((row) => row.status === 'started')?.details?.path, undefined);
    assert.ok(!JSON.stringify(rows).includes('/host/private-file'));
    assert.ok(!JSON.stringify(rows).includes('Invalid workshop input'));
  } finally {
    f.store.close();
  }
});

test('serialized detail secret guard redacts validation keys and rejects model echoes', async () => {
  const f = setup();
  try {
    // Schema issue paths can themselves contain untrusted object keys.
    f.projects.validate = () => ({ valid: false, issues: [`${f.key}: unrecognized_keys`] });
    await assert.rejects(
      f.engine([{ tool: 'validate_component' }]).run('owner', f.project.id, f.profile.id),
      /凭据/,
    );
    let rows = f.conversation.list('owner', f.project.id);
    assert.equal(
      rows.find((row) => row.content === 'validate_component' && row.status === 'failed')?.details
        ?.summary,
      '工具执行失败，已停止',
    );
    assert.ok(!JSON.stringify(rows).includes(f.key));
    await assert.rejects(
      f.engine([{ tool: 'finish', message: f.key }]).run('owner', f.project.id, f.profile.id),
      /敏感凭据/,
    );
    rows = f.conversation.list('owner', f.project.id);
    assert.ok(!JSON.stringify(rows).includes(f.key));
    const vault = new ProviderVault(f.store.db, 'test-only-master-secret-at-least-32-characters', {
      mock: 'https://provider.example/v1',
    });
    const profile = vault.save('owner', {
      label: 'detail-key',
      endpointId: 'mock',
      model: 'mock',
      apiKey: 'durationMs',
    });
    const engine = new WorkshopEngine(
      f.projects,
      vault,
      (async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify({ tool: 'ask_user', message: '请补充' }) } },
            ],
          }),
        )) as typeof fetch,
      f.conversation,
    );
    await engine.run('owner', f.project.id, profile.id);
    rows = f.conversation.list('owner', f.project.id);
    assert.equal(
      rows.findLast((row) => row.role === 'tool')?.details?.summary,
      '工具详情包含敏感信息，已隐藏',
    );
  } finally {
    f.store.close();
  }
});

test('details count toward the retained history byte budget', () => {
  const f = setup();
  try {
    for (let i = 0; i < 200; i++)
      f.conversation.append('owner', f.project.id, {
        role: 'tool',
        content: 'validate_component',
        details: { issues: Array(8).fill('中'.repeat(160)), summary: '中'.repeat(300) },
      });
    const rows = f.conversation.list('owner', f.project.id);
    assert.ok(rows.length < 200);
    assert.ok(rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row)), 0) <= 256000);
    assert.equal(rows.at(-1)?.sequence, 200);
  } finally {
    f.store.close();
  }
});
