import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeExecutionMessages,
  executionStatus,
} from '../web/features/workshop/ExecutionTimeline.tsx';
import type { WorkshopMessage } from '../web/features/workshop/types.ts';
const message = (
  id: string,
  status: string,
  extra: Partial<WorkshopMessage> = {},
): WorkshopMessage => ({
  id,
  projectId: 'p',
  role: 'tool',
  content: 'write_file',
  status,
  createdAt: '2026-11-12',
  sequence: Number(id),
  runId: 'r',
  callId: 'c',
  ...extra,
});
test('timeline pairs calls into one truthful row and isolates separate runs', () => {
  const entries = mergeExecutionMessages([
    message('1', 'started', { details: { path: '/project/component.json' } }),
    message('2', 'completed', { details: { bytes: 50, durationMs: 10 } }),
    message('3', 'started', { runId: 'other' }),
  ]);
  assert.equal(entries.length, 2);
  const first = entries[0];
  assert.equal(first.kind, 'execution');
  if (first.kind === 'execution') {
    assert.equal(first.latest.status, 'completed');
    assert.equal(first.details.path, '/project/component.json');
    assert.equal(first.details.bytes, 50);
  }
  assert.equal(executionStatus('started', false), '未完成');
  assert.equal(executionStatus('started', true), '执行中');
});
test('legacy summaries pair only adjacent corresponding tool events', () => {
  const rows = mergeExecutionMessages([
    message('1', 'started', { callId: undefined }),
    message('2', 'completed', { callId: undefined }),
    message('3', 'started', { callId: undefined }),
    message('4', 'completed', { callId: undefined, content: 'read_file' }),
  ]);
  assert.equal(rows.length, 3);
});
