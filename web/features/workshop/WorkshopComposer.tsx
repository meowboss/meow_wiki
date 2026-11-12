import { ArrowUp, Info, Square } from 'lucide-react';
import { useLayoutEffect, useRef, type FormEvent } from 'react';
import type { Provider } from './types';

type Props = {
  hasProject: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  providers: Provider[];
  providerId: string;
  onProviderChange: (value: string) => void;
  disabled: boolean;
  canSend: boolean;
  running: boolean;
  cancelling: boolean;
  onSend: (event: FormEvent) => void;
  onCancel: () => void;
};

export default function WorkshopComposer({
  hasProject,
  draft,
  onDraftChange,
  providers,
  providerId,
  onProviderChange,
  disabled,
  canSend,
  running,
  cancelling,
  onSend,
  onCancel,
}: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
  }, [draft]);
  const sendLabel = hasProject ? '发送消息' : '发送并创建组件项目';
  const cancelLabel = cancelling ? '正在请求取消…' : '请求取消运行';
  return (
    <form className="workshop-composer" onSubmit={onSend}>
      <label className="workshop-chat-sr-only" htmlFor="workshop-message">
        {hasProject ? '继续描述修改，或回答助手的问题' : '描述需求'}
      </label>
      <textarea
        ref={input}
        id="workshop-message"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        rows={2}
        maxLength={3000}
        disabled={disabled || running}
        placeholder="描述需求，支持换行…"
        required
      />
      <div className="workshop-composer-toolbar">
        <label className="workshop-chat-sr-only" htmlFor="workshop-chat-provider">
          对话使用的 Provider
        </label>
        <select
          id="workshop-chat-provider"
          value={providerId}
          disabled={disabled || running}
          onChange={(event) => onProviderChange(event.target.value)}
        >
          <option value="">选择已配置的 Provider</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label} · {provider.model}
              {!provider.configured ? '（未配置）' : ''}
            </option>
          ))}
        </select>
        <details className="workshop-request-warning">
          <summary title="发送提示" aria-label="发送提示">
            <Info size={15} aria-hidden="true" />
          </summary>
          <p>
            发送会向所选 Provider 提交对话与项目内容，可能产生费用。请勿输入密钥。
            {providers
              .find((provider) => provider.id === providerId)
              ?.baseURL?.startsWith('http:') &&
              ' 当前 Provider 使用 HTTP，传输不加密，请仅用于可信网络。'}
          </p>
        </details>
        {running ? (
          <button
            type="button"
            className="workshop-chat-icon workshop-stop-button"
            disabled={cancelling}
            onClick={onCancel}
            title={cancelLabel}
            aria-label={cancelLabel}
          >
            <Square size={16} aria-hidden="true" />
          </button>
        ) : (
          <button
            className="workshop-chat-icon workshop-send-button"
            disabled={disabled || !canSend || !draft.trim()}
            title={sendLabel}
            aria-label={sendLabel}
          >
            <ArrowUp size={19} aria-hidden="true" />
          </button>
        )}
      </div>
      {!canSend && <p className="workshop-composer-notice">请先配置或选择 Provider。</p>}
    </form>
  );
}
