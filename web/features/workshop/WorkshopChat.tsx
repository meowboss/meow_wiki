import { useEffect, useRef, type FormEvent } from 'react';
import type { Project, Provider, WorkshopMessage } from './types';

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
  draft: '等待你的回复 / 可继续对话',
  running: '服务端正在执行',
  ready: '产物已就绪，可预览并保存',
  failed: '执行失败，可核对事件后继续',
  cancelled: '执行已取消',
  interrupted: '执行已中断，请核对事件',
  installed: '已保存为私有组件',
};
export default function WorkshopChat({
  project,
  messages,
  draft,
  onDraftChange,
  providers,
  providerId,
  onProviderChange,
  disabled,
  canSend,
  running,
  cancelling,
  pollingError,
  onSend,
  onCancel,
  onRefresh,
}: Props) {
  const list = useRef<HTMLOListElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (follow.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages]);
  const statuses: Record<string, string> = {
    started: '执行中',
    completed: '已完成',
    failed: '失败',
    question: '等待回复',
    cancelled: '已取消',
    error: '错误',
  };
  const toolNames: Record<string, string> = {
    read_file: '读取项目/SDK',
    write_file: '更新组件内容',
    validate_component: '校验组件',
    ask_user: '澄清需求',
    finish: '完成本轮',
  };
  return (
    <section className="workshop-panel workshop-chat" aria-labelledby="workshop-chat-title">
      <h2 id="workshop-chat-title">{project?.name || '和 AI 一起创建组件'}</h2>
      <p className="workshop-chat-hint">生成后需明确保存为私有组件，不会自动发布。</p>
      {project && (
        <div className="workshop-session-status">
          <p role="status">
            服务端状态：<strong>{states[project.state] || project.state}</strong> ·{' '}
            {project.iterations} / 8 轮
          </p>
          <button className="text-btn" disabled={disabled && !running} onClick={onRefresh}>
            刷新对话与项目
          </button>
        </div>
      )}
      {pollingError && (
        <p className="workshop-warning" role="status">
          {pollingError}
        </p>
      )}
      <ol
        className="workshop-messages"
        ref={list}
        onScroll={() => {
          const node = list.current;
          if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 70;
        }}
        aria-label="项目对话与执行事件"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {messages.map((item) => (
          <li
            key={item.id}
            className={`workshop-message workshop-message-${item.role}`}
            data-message-role={item.role}
          >
            <div className="workshop-message-heading">
              <strong>{roles[item.role]}</strong>
              {item.status && <small>{statuses[item.status] ?? item.status}</small>}
            </div>
            <div className="workshop-message-content">
              {item.role === 'tool' ? (toolNames[item.content] ?? item.content) : item.content}
            </div>
          </li>
        ))}
      </ol>
      {!project && !messages.length && (
        <p className="workshop-empty">描述需求即可开始，例如“创建团队知识导航”。</p>
      )}
      {running && (
        <p role="status">
          正在等待服务端执行事件。这里只显示真实消息与安全工具摘要，不展示模型内部思考。
        </p>
      )}
      <form onSubmit={onSend}>
        <label>
          对话使用的 Provider
          <select
            value={providerId}
            disabled={disabled || running}
            onChange={(e) => onProviderChange(e.target.value)}
          >
            <option value="">选择已配置的 Provider</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label} · {provider.model}
                {!provider.configured ? '（未配置）' : ''}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="workshop-message">
          {project ? '继续描述修改，或回答助手的问题' : '描述你想创建的组件'}
          <textarea
            id="workshop-message"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={4}
            maxLength={3000}
            disabled={disabled || running}
            placeholder="用自然语言描述需求，支持换行…"
            required
          />
        </label>
        {!canSend && <p>请先配置或选择 Provider。</p>}
        <p className="workshop-request-warning">
          发送会向所选 Provider 提交对话与组件内容，可能产生费用。请勿输入密钥。
          {providers.find((provider) => provider.id === providerId)?.baseURL?.startsWith('http:') &&
            ' 当前 Provider 使用 HTTP，传输不加密，请仅用于可信网络。'}
        </p>
        <div className="workshop-actions">
          <button
            className="primary-btn"
            disabled={disabled || running || !canSend || !draft.trim()}
          >
            {project ? '发送消息' : '发送并创建组件项目'}
          </button>
          {running && (
            <button
              type="button"
              className="secondary-btn"
              disabled={cancelling}
              onClick={onCancel}
            >
              {cancelling ? '正在请求取消…' : '请求取消运行'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
