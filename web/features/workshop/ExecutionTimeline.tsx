import type { WorkshopMessage, WorkshopMessageDetails } from './types';

export type ExecutionEntry = {
  kind: 'execution';
  id: string;
  first: WorkshopMessage;
  latest: WorkshopMessage;
  details: WorkshopMessageDetails;
};
export type ConversationEntry = ExecutionEntry | { kind: 'message'; message: WorkshopMessage };

const toolNames: Record<string, string> = {
  read_file: '读取项目 / SDK',
  write_file: '更新组件内容',
  validate_component: '校验组件',
  ask_user: '澄清需求',
  finish: '完成本轮',
};
const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'error', 'question']);

export function executionName(tool: string) {
  return toolNames[tool] ?? '工具执行';
}

export function executionStatus(status: string | undefined, running: boolean) {
  switch (status) {
    case 'started':
      return running ? '执行中' : '未完成';
    case 'completed':
      return '已完成';
    case 'failed':
    case 'error':
      return '失败';
    case 'cancelled':
      return '已取消';
    case 'question':
      return '等待回复';
    default:
      return '状态未确认';
  }
}

/** Keep calls at their original position; legacy events only pair with an adjacent open call. */
export function mergeExecutionMessages(messages: WorkshopMessage[]): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  const calls = new Map<string, ExecutionEntry>();
  for (const message of messages) {
    if (message.role !== 'tool') {
      entries.push({ kind: 'message', message });
      continue;
    }
    const key = message.callId
      ? JSON.stringify([message.projectId, message.runId ?? '', message.callId])
      : undefined;
    const previous = entries.at(-1);
    const legacy =
      !message.callId &&
      terminalStatuses.has(message.status ?? '') &&
      previous?.kind === 'execution' &&
      !previous.first.callId &&
      previous.latest.status === 'started' &&
      previous.first.projectId === message.projectId &&
      previous.first.runId === message.runId &&
      previous.first.turn === message.turn &&
      previous.first.content === message.content
        ? previous
        : undefined;
    const existing = key ? calls.get(key) : legacy;
    if (existing) {
      existing.latest = message;
      existing.details = { ...existing.details, ...message.details };
    } else {
      const entry: ExecutionEntry = {
        kind: 'execution',
        id: message.id,
        first: message,
        latest: message,
        details: { ...message.details },
      };
      entries.push(entry);
      if (key) calls.set(key, entry);
    }
  }
  return entries;
}

function duration(entry: ExecutionEntry) {
  const reported = entry.details.durationMs;
  if (reported !== undefined && Number.isFinite(reported) && reported >= 0) return reported;
  if (entry.first.status !== 'started' || !terminalStatuses.has(entry.latest.status ?? ''))
    return undefined;
  const elapsed = Date.parse(entry.latest.createdAt) - Date.parse(entry.first.createdAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined;
}

export default function ExecutionTimeline({
  entry,
  running,
}: {
  entry: ExecutionEntry;
  running: boolean;
}) {
  const { first, latest, details } = entry;
  const elapsed = duration(entry);
  const status = executionStatus(latest.status, running);
  const elapsedText =
    elapsed === undefined
      ? '耗时待确认'
      : elapsed < 1000
        ? `${elapsed} 毫秒`
        : `${(elapsed / 1000).toFixed(1)} 秒`;
  return (
    <li
      className="workshop-message workshop-message-tool workshop-execution"
      data-message-role="tool"
      data-execution-status={latest.status ?? 'unknown'}
    >
      <details className="workshop-execution-details">
        <summary>
          <span className="workshop-execution-name">{executionName(first.content)}</span>
          <span className="workshop-execution-status">{status}</span>
          <span className="workshop-execution-duration">{elapsedText}</span>
        </summary>
        <div className="workshop-execution-body">
          {details.summary && <p className="workshop-execution-summary">{details.summary}</p>}
          <dl>
            {details.path !== undefined && (
              <>
                <dt>文件</dt>
                <dd>{details.path}</dd>
              </>
            )}
            {details.bytes !== undefined && (
              <>
                <dt>大小</dt>
                <dd>{details.bytes.toLocaleString()} 字节</dd>
              </>
            )}
            {details.lines !== undefined && (
              <>
                <dt>行数</dt>
                <dd>{details.lines.toLocaleString()} 行</dd>
              </>
            )}
            {details.valid !== undefined && (
              <>
                <dt>校验</dt>
                <dd>{details.valid ? '通过' : '未通过'}</dd>
              </>
            )}
            {latest.runId && (
              <>
                <dt>运行</dt>
                <dd>{latest.runId}</dd>
              </>
            )}
            {latest.turn !== undefined && (
              <>
                <dt>轮次</dt>
                <dd>第 {latest.turn} 轮</dd>
              </>
            )}
          </dl>
          {!!details.issues?.length && (
            <div className="workshop-execution-issues">
              <strong>发现的问题</strong>
              <ul>
                {details.issues.map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          {!details.summary &&
            details.path === undefined &&
            details.bytes === undefined &&
            details.lines === undefined &&
            details.valid === undefined &&
            !details.issues?.length && <p>这次执行未提供更多详情。</p>}
        </div>
      </details>
    </li>
  );
}
