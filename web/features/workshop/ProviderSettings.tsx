import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../shared/api';
import { providerMetadata, type Config, type Provider } from './types';

type Props = {
  config: Config;
  providers: Provider[];
  disabled: boolean;
  onProvidersChange: (providers: Provider[]) => void;
  onSelected: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  action: (key: string, task: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  onNotice: (notice: string) => void;
};
export default function ProviderSettings({
  config,
  providers,
  disabled,
  onProvidersChange,
  onSelected,
  onDirtyChange,
  action,
  onNotice,
}: Props) {
  const [label, setLabel] = useState('');
  const [endpointId, setEndpointId] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const ready = config.configured && config.endpoints.length > 0;
  useEffect(() => {
    onDirtyChange(!!(label || model || apiKey));
  }, [label, model, apiKey, onDirtyChange]);
  function save(event: FormEvent) {
    event.preventDefault();
    if (
      !ready ||
      !label.trim() ||
      !model.trim() ||
      !apiKey.trim() ||
      !config.endpoints.some((endpoint) => endpoint.id === endpointId)
    )
      return;
    void action('provider', async (signal) => {
      const secret = apiKey;
      setApiKey('');
      try {
        const result = await api<Provider>(
          '/workshop/providers',
          { label: label.trim(), endpointId, model: model.trim(), apiKey: secret },
          'POST',
          signal,
        );
        if (signal.aborted) return;
        const record = providerMetadata(result);
        onProvidersChange([record, ...providers.filter((item) => item.id !== record.id)]);
        onSelected(record.id);
        setLabel('');
        setModel('');
        onNotice('Provider 已保存，仅保留元数据；密钥输入已清除。');
      } catch {
        throw new Error(
          'Provider 保存未确认。密钥输入已清除，请刷新 Provider 列表核对后再试；不会展示可能包含密钥的服务错误。',
        );
      }
    });
  }
  return (
    <details className="workshop-panel workshop-settings" open={!providers.length}>
      <summary id="workshop-providers">Provider 设置</summary>
      <p>
        密钥由服务端加密存储；本页只保留公开元数据。只允许服务端配置的端点，不接受自定义 URL。API
        Key 仅在内存输入，提交后立即清空，不写入组件或对话。
      </p>
      <form onSubmit={save}>
        <fieldset disabled={disabled}>
          <label>
            Provider 名称
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              maxLength={120}
            />
          </label>
          <label>
            模型端点
            <select value={endpointId} onChange={(e) => setEndpointId(e.target.value)}>
              <option value="">选择端点</option>
              {config.endpoints.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            模型名称
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              required
              maxLength={200}
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
            />
          </label>
          <button
            className="primary-btn"
            disabled={!ready || !endpointId || !label.trim() || !model.trim() || !apiKey.trim()}
          >
            保存 Provider
          </button>
        </fieldset>
      </form>
      <ul className="workshop-providers">
        {providers.map((provider) => (
          <li key={provider.id}>
            <span>
              <strong>{provider.label}</strong>
              <small>
                {provider.model} ·{' '}
                {config.endpoints.find((item) => item.id === provider.endpointId)?.label ||
                  provider.endpointId}{' '}
                · {provider.configured ? '已配置' : '未配置'}
              </small>
            </span>
            <button
              className="text-btn"
              disabled={disabled}
              aria-label={`删除 Provider ${provider.label}`}
              onClick={() => {
                if (!window.confirm(`确定删除 Provider“${provider.label}”吗？`)) return;
                void action('delete-provider', async (signal) => {
                  await api(
                    `/workshop/providers/${encodeURIComponent(provider.id)}`,
                    undefined,
                    'DELETE',
                    signal,
                  );
                  if (!signal.aborted)
                    onProvidersChange(providers.filter((item) => item.id !== provider.id));
                });
              }}
            >
              删除
            </button>
          </li>
        ))}
      </ul>
      {!providers.length && <p>尚无 Provider。填写真实凭据后才能开始对话。</p>}
      <button
        className="text-btn"
        disabled={disabled}
        onClick={() =>
          void action('refresh-providers', async (signal) => {
            const result = await api<{ providers: Provider[] }>(
              '/workshop/providers',
              undefined,
              'GET',
              signal,
            );
            if (!signal.aborted) onProvidersChange(result.providers.map(providerMetadata));
          })
        }
      >
        刷新 Provider 列表
      </button>
    </details>
  );
}
