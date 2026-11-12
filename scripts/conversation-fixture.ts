import Fastify from 'fastify';
import { createApp } from '../src/app.ts';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
// Dedicated acceptance fixture only: never mounted in the user application.
const provider = Fastify();
provider.post('/v1/chat/completions', async (request) => {
  const body = request.body as { messages: { role: string; content: string }[] };
  const messages = body.messages;
  const text = JSON.stringify(messages);
  const hasAnswer = text.includes('读书笔记');
  const latestUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  let action: unknown;
  if (text.includes('meow.page')) {
    if (latestUser.includes('written')) action = { tool: 'validate_project' };
    else if (latestUser.includes('valid'))
      action = { tool: 'finish', message: '页面工作副本已通过校验，请预览后明确保存。' };
    else
      action = {
        tool: 'write_file',
        path: '/project/page.json',
        content: JSON.stringify({
          format: 'meow.page',
          version: 1,
          name: '对话创作页面',
          composition: {
            schemaVersion: 2,
            surface: 'wiki',
            layout: 'flow',
            columns: 12,
            gap: 16,
            background: '#ffffff',
            instances: [
              {
                id: 'agent-text',
                viewId: 'builtin.text',
                visible: true,
                layer: 'content',
                x: 0,
                y: 0,
                w: 12,
                h: 1,
                config: { text: '这是Agent对话生成的独立页面' },
                style: {},
              },
            ],
          },
        }),
      };
  } else if (!hasAnswer)
    action = { tool: 'ask_user', message: '你希望组件用于什么场景？例如读书笔记。' };
  else if (latestUser.includes('written') || latestUser.includes('写入'))
    action = { tool: 'validate_component' };
  else if (latestUser.includes('valid'))
    action = { tool: 'finish', message: '读书笔记组件已完成校验，你可以预览并保存为私有组件。' };
  else
    action = {
      tool: 'write_file',
      path: '/project/component.json',
      content: JSON.stringify({
        name: '对话读书卡',
        description: '由对话需求创建',
        template: '# 读书笔记',
        blocks: [
          {
            type: 'markdown',
            text: text.includes('增加思考')
              ? '# 读书笔记\n\n## 我的思考'
              : '# 读书笔记\n\n记录核心观点。',
          },
        ],
      }),
    };
  return { choices: [{ message: { content: JSON.stringify(action) } }] };
});
await provider.listen({ host: '127.0.0.1', port: 3031 });
const app = createApp({
  mode: 'session',
  databasePath: ':memory:',
  authBaseURL: 'http://localhost:3030',
  authSecret: 'acceptance-only-auth-secret-longer-than32',
  workshop: {
    masterSecret: 'acceptance-only-vault-secret-longer-than32',
    allowedEndpoints: { acceptance: 'http://127.0.0.1:3031/v1' },
  },
});
await app.register(staticFiles, { root: resolve('dist') });
await app.listen({ host: '127.0.0.1', port: 3030 });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close().then(() => provider.close());
  });
