import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../shared/api';
import { providerMetadata, type Config, type Provider, type ProviderVendor } from './types';

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
const presets: Record<ProviderVendor, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  custom: '',
};
const isCustom = (provider: Provider) =>
  provider.source === 'custom' || !!(provider.vendor && provider.baseURL);

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
  const [editing, setEditing] = useState<Provider | null>(null);
  const [label, setLabel] = useState('');
  const [vendor, setVendor] = useState<ProviderVendor>('openai');
  const [baseURL, setBaseURL] = useState(presets.openai);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const credentialsChanged =
    !!editing && (vendor !== editing.vendor || baseURL.trim() !== editing.baseURL);
  const canResolveKey = !!editing?.configured && !credentialsChanged;
  const credentialsReady = !!baseURL.trim() && (!!apiKey.trim() || canResolveKey);
  const dirty =
    !!apiKey ||
    label !== (editing?.label ?? '') ||
    model !== (editing?.model ?? '') ||
    vendor !== (editing?.vendor ?? 'openai') ||
    baseURL !== (editing?.baseURL ?? presets.openai);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    setModels([]);
  }, [vendor, baseURL, apiKey, editing?.id]);

  function reset() {
    setEditing(null);
    setLabel('');
    setVendor('openai');
    setBaseURL(presets.openai);
    setModel('');
    setApiKey('');
    setModels([]);
  }
  function editProvider(provider: Provider) {
    if (dirty && !window.confirm('放弃当前未保存的 Provider 输入并开始编辑吗？')) return;
    setEditing(provider);
    setLabel(provider.label);
    setVendor(provider.vendor ?? 'custom');
    setBaseURL(provider.baseURL ?? '');
    setModel(provider.model);
    setApiKey('');
    setModels([]);
  }
  function credentials() {
    return {
      vendor,
      baseURL: baseURL.trim(),
      ...(apiKey.trim() ? { apiKey } : {}),
      ...(editing ? { providerId: editing.id } : {}),
    };
  }
  function fetchModels() {
    if (!credentialsReady) return;
    void action('provider-models', async (signal) => {
      try {
        const result = await api<{ models: { id: string }[]; source: 'remote' }>(
          '/workshop/providers/custom/models',
          credentials(),
          'POST',
          signal,
        );
        if (signal.aborted) return;
        setModels([...new Set(result.models.map((item) => item.id))]);
        onNotice(
          `已从远端获取 ${result.models.length} 个模型；仅证明可列模型，不代表推理连接成功。仍可手动填写模型。`,
        );
      } catch {
        if (signal.aborted) return;
        setModels([]);
        throw new Error(
          '获取模型列表失败。可继续手填模型并保存；密钥输入保留，不展示服务端错误详情。',
        );
      }
    });
  }
  function testConnection() {
    if (!credentialsReady || !model.trim()) return;
    void action('provider-test', async (signal) => {
      try {
        const result = await api<{ ok: true; model: string; latencyMs: number }>(
          '/workshop/providers/custom/test',
          { ...credentials(), model: model.trim() },
          'POST',
          signal,
        );
        if (!signal.aborted && result.ok === true)
          onNotice(
            `推理连接测试成功，耗时 ${result.latencyMs} ms。此结果仅代表本次测试，不会自动保存 Provider。`,
          );
      } catch {
        if (signal.aborted) return;
        throw new Error(
          '推理连接测试失败。请检查供应商、URL、模型与密钥；密钥输入保留，不展示服务端错误详情。',
        );
      }
    });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!credentialsReady || !label.trim() || !model.trim()) return;
    void action('provider', async (signal) => {
      const payload = {
        label: label.trim(),
        vendor,
        baseURL: baseURL.trim(),
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey } : {}),
      };
      // Clear at submission, including failures. Never restore secrets from a response.
      setApiKey('');
      try {
        const result = await api<Provider>(
          editing
            ? `/workshop/providers/custom/${encodeURIComponent(editing.id)}`
            : '/workshop/providers/custom',
          payload,
          editing ? 'PUT' : 'POST',
          signal,
        );
        if (signal.aborted) return;
        const record = providerMetadata(result);
        onProvidersChange([record, ...providers.filter((item) => item.id !== record.id)]);
        onSelected(record.id);
        reset();
        onNotice('Provider 已保存，仅保留元数据；密钥输入已清除。');
      } catch {
        if (signal.aborted) return;
        throw new Error(
          'Provider 保存未确认。密钥输入已清除，请刷新 Provider 列表核对后再试；不会展示可能包含密钥的服务错误。',
        );
      }
    });
  }
  return (
    <details className="workshop-panel workshop-settings" open={!providers.length || !!editing}>
      <summary id="workshop-providers">Provider 设置</summary>
      <p>
        协议：OpenAI-compatible（非原生 Anthropic）。供应商预设仅填写 URL，不依赖管理员配置的 host
        端点。 密钥由服务端加密存储；API Key
        仅在内存输入，不写入对话，保存发起时立即清空，获取模型或测试失败时保留。
      </p>
      <form onSubmit={save}>
        <fieldset disabled={disabled}>
          <legend>{editing ? `编辑 Provider：${editing.label}` : '新增 Provider'}</legend>
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
            供应商
            <select
              value={vendor}
              onChange={(e) => {
                const next = e.target.value as ProviderVendor;
                setVendor(next);
                setBaseURL(presets[next]);
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="custom">自定义（OpenAI-compatible）</option>
            </select>
          </label>
          <label>
            Base URL
            <input
              type="url"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              required
              placeholder="https://example.com/v1"
              autoComplete="off"
            />
          </label>
          <label>
            模型名称（可从列表选择或手动填写）
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="workshop-provider-models"
              required
              maxLength={200}
            />
            <datalist id="workshop-provider-models">
              {models.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </label>
          <label>
            API Key
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required={!canResolveKey}
              placeholder={
                editing?.configured ? '已配置；留空保留原密钥，不会回填' : '输入 API Key'
              }
            />
          </label>
          {credentialsChanged && <p>更换供应商或 Base URL 必须输入新密钥，不能复用原凭据。</p>}
          <p>
            获取模型列表仅证明可列模型，不等同推理连接。推理连接测试会发送真实请求，可能产生少量费用；未保存也可测试。
          </p>
          <div className="workshop-actions">
            <button
              type="button"
              className="secondary-btn"
              disabled={!credentialsReady}
              onClick={fetchModels}
            >
              获取模型列表
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={!credentialsReady || !model.trim()}
              onClick={testConnection}
            >
              测试推理连接（可能产生少量费用）
            </button>
            <button
              className="primary-btn"
              disabled={!credentialsReady || !label.trim() || !model.trim()}
            >
              {editing ? '保存修改' : '保存 Provider'}
            </button>
            {editing && (
              <button
                type="button"
                className="text-btn"
                onClick={() => {
                  if (!dirty || window.confirm('放弃未保存的 Provider 修改吗？')) reset();
                }}
              >
                取消编辑
              </button>
            )}
          </div>
        </fieldset>
      </form>
      <ul className="workshop-providers">
        {providers.map((provider) => (
          <li key={provider.id}>
            <span>
              <strong>{provider.label}</strong>
              <small>
                {provider.model} ·{' '}
                {provider.vendor ||
                  config.endpoints.find((item) => item.id === provider.endpointId)?.label ||
                  provider.endpointId}
                {provider.baseURL ? ` · ${provider.baseURL}` : ''} ·{' '}
                {provider.configured ? '已配置' : '未配置'}
              </small>
            </span>
            {isCustom(provider) && (
              <button
                type="button"
                className="text-btn"
                disabled={disabled}
                aria-label={`编辑 Provider ${provider.label}`}
                onClick={() => editProvider(provider)}
              >
                编辑
              </button>
            )}
            <button
              type="button"
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
                  if (!signal.aborted) {
                    onProvidersChange(providers.filter((item) => item.id !== provider.id));
                    if (editing?.id === provider.id) reset();
                  }
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
        type="button"
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
