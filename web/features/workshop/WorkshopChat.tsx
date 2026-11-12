import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import ExecutionTimeline, {
  executionName,
  executionStatus,
  mergeExecutionMessages,
} from './ExecutionTimeline';
import WorkshopComposer from './WorkshopComposer';
import type { Project, Provider, WorkshopMessage } from './types';
import './timeline.css';
import './chat-shell.css';

type Props = {
  project: Project | null;
  messages: WorkshopMessage[];
  draft: string;
  onDraftChange: (value: string) => void;
  providers: Provider[];
  providerId: string;
  onProviderChange: (value: string) => void;
  disabled: boolean;
  canSend: boolean;
  running: boolean;
  cancelling: boolean;
  pollingError: string;
  onSend: (event: FormEvent) => void;
  onCancel: () => void;
  onRefresh: () => void;
};
const roles = { user: '你', assistant: '助手', tool: '工具执行摘要', system: '系统事件' };
const states: Record<string, string> = {
  draft: '等待回复',
  running: '执行中',
  ready: '已就绪',
  failed: '执行失败',
  cancelled: '已取消',
  interrupted: '已中断',
  installed: '已保存',
};
type Tab = 'conversation' | 'timeline';
export default function WorkshopChat(props: Props) {
  const { project, messages, disabled, running, pollingError, onRefresh } = props;
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const observed = useRef<{ projectId?: string; events: Map<string, string> }>({
    events: new Map(),
  });
  const [announcement, setAnnouncement] = useState('');
  const [tab, setTab] = useState<Tab>('conversation');
  const entries = mergeExecutionMessages(messages);
  const conversation = messages.filter((item) => item.role === 'user' || item.role === 'assistant');
  const timeline = entries.filter(
    (entry) => entry.kind === 'execution' || entry.message.role === 'system',
  );
  const steps = entries.filter((entry) => entry.kind === 'execution').length;
  const latestRunId = messages.findLast((item) => item.runId)?.runId;
  const latestUserSequence = messages.findLast((item) => item.role === 'user')?.sequence ?? 0;
  useEffect(() => {
    follow.current = true;
    setTab('conversation');
  }, [project?.id]);
  useEffect(() => {
    if (follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
    const projectId = project?.id;
    const current = new Map(messages.map((item) => [item.id, item.status ?? '']));
    if (observed.current.projectId === projectId && observed.current.events.size) {
      const changed = messages.filter(
        (item) => observed.current.events.get(item.id) !== (item.status ?? ''),
      );
      const latest = changed.at(-1);
      if (latest)
        setAnnouncement(
          latest.role === 'tool'
            ? `${executionName(latest.content)}，${executionStatus(latest.status, running)}`
            : latest.role === 'system'
              ? '轨迹已更新'
              : `${roles[latest.role]}：${latest.content}`,
        );
    } else setAnnouncement('');
    observed.current = { projectId, events: current };
  }, [messages, project?.id, running]);
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 'conversation'
        : event.key === 'End'
          ? 'timeline'
          : tab === 'conversation'
            ? 'timeline'
            : 'conversation';
    setTab(next);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-chat-tab="${next}"]`)
      ?.focus();
  }
  return (
    <section className="workshop-panel workshop-chat" aria-labelledby="workshop-chat-title">
      <header className="workshop-chat-header">
        <h2 id="workshop-chat-title" title={project?.name || '描述需求'}>
          {project?.name || '描述需求'}
        </h2>
        {project && (
          <button
            type="button"
            className="workshop-chat-icon"
            disabled={disabled && !running}
            onClick={onRefresh}
            title="刷新对话与项目"
            aria-label="刷新对话与项目"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="workshop-chat-navigation">
        <div className="workshop-chat-tabs" role="tablist" aria-label="项目交流">
          {(['conversation', 'timeline'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`workshop-tab-${value}`}
              aria-controls={`workshop-panel-${value}`}
              aria-selected={tab === value}
              tabIndex={tab === value ? 0 : -1}
              data-chat-tab={value}
              onClick={() => setTab(value)}
              onKeyDown={navigateTabs}
            >
              {value === 'conversation' ? '对话' : '轨迹'}
            </button>
          ))}
        </div>
        <p className="workshop-chat-status" role="status">
          <span className="workshop-chat-status-dot" data-running={running} aria-hidden="true" />
          {running ? '执行中' : project ? states[project.state] || project.state : '等待开始'}
          <span>已执行 {steps} 步</span>
        </p>
      </div>
      {pollingError && (
        <p className="workshop-chat-error" role="status">
          {pollingError}
        </p>
      )}
      <div
        className="workshop-chat-viewport"
        ref={viewport}
        onScroll={() => {
          const node = viewport.current;
          if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 70;
        }}
      >
        <div
          role="tabpanel"
          id="workshop-panel-conversation"
          aria-labelledby="workshop-tab-conversation"
          hidden={tab !== 'conversation'}
          tabIndex={0}
        >
          {conversation.length ? (
            <ol className="workshop-messages" aria-label="项目对话">
              {conversation.map((item) => (
                <li
                  key={item.id}
                  className={`workshop-message workshop-message-${item.role}`}
                  data-message-role={item.role}
                >
                  <div className="workshop-message-heading">{roles[item.role]}</div>
                  <div className="workshop-message-content">{item.content}</div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="workshop-chat-empty">
              <p>描述需求，和 AI 一起开始。</p>
              <span>例如：创建团队知识导航</span>
            </div>
          )}
        </div>
        <div
          role="tabpanel"
          id="workshop-panel-timeline"
          aria-labelledby="workshop-tab-timeline"
          hidden={tab !== 'timeline'}
          tabIndex={0}
        >
          {timeline.length ? (
            <ol className="workshop-messages" aria-label="项目执行轨迹">
              {timeline.map((entry) => {
                if (entry.kind === 'execution') {
                  const active =
                    running &&
                    (entry.latest.runId
                      ? entry.latest.runId === latestRunId
                      : entry.first.sequence > latestUserSequence);
                  return <ExecutionTimeline key={entry.id} entry={entry} running={active} />;
                }
                return (
                  <li
                    key={entry.message.id}
                    className="workshop-message workshop-message-system"
                    data-message-role="system"
                  >
                    <div className="workshop-message-heading">系统事件</div>
                    <div className="workshop-message-content">{entry.message.content}</div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="workshop-chat-empty">
              <p>执行后将在这里显示轨迹。</p>
            </div>
          )}
        </div>
      </div>
      <div className="workshop-chat-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <WorkshopComposer {...props} hasProject={!!project} />
    </section>
  );
}
