import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import ProviderSettings from './ProviderSettings';
import { providerMetadata, type Config, type Provider } from './types';
import './providers.css';
import type { ReactNode } from 'react';

type Props = {
  selectedId: string;
  usageNotes?: ReactNode;
  onSelected: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
};

export default function ProviderSettingsPanel({
  selectedId,
  usageNotes,
  onSelected,
  onDirtyChange,
  onBusyChange,
}: Props) {
  const [config, setConfig] = useState<Config>({ endpoints: [], configured: false });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const pending = useRef<AbortController | null>(null);
  // Parent callbacks may be inline. Their identity must not restart requests or selection effects.
  const callbacks = useRef({ onSelected, onDirtyChange, onBusyChange });
  useEffect(() => {
    callbacks.current = { onSelected, onDirtyChange, onBusyChange };
  });
  const select = useCallback((id: string) => callbacks.current.onSelected(id), []);
  const dirtyChange = useCallback((dirty: boolean) => callbacks.current.onDirtyChange(dirty), []);

  const action = useCallback(async (_key: string, task: (signal: AbortSignal) => Promise<void>) => {
    // Synchronous lock also covers two actions fired before React commits disabled controls.
    if (!mounted.current || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setNotice('');
    callbacks.current.onBusyChange(true);
    try {
      await task(controller.signal);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted)
        setNotice(error instanceof Error ? error.message : 'Provider 操作失败，请重试。');
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (mounted.current) {
          setBusy(false);
          callbacks.current.onBusyChange(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void action('load-providers', async (signal) => {
      try {
        const [nextConfig, result] = await Promise.all([
          api<Config>('/workshop/config', undefined, 'GET', signal),
          api<{ providers: Provider[] }>('/workshop/providers', undefined, 'GET', signal),
        ]);
        if (signal.aborted) return;
        setConfig(nextConfig);
        setProviders(result.providers.map(providerMetadata));
        setLoaded(true);
      } catch {
        if (!signal.aborted) throw new Error('Provider 配置加载失败，请刷新页面重试。');
      }
    });
    return () => {
      mounted.current = false;
      pending.current?.abort();
      pending.current = null;
      callbacks.current.onBusyChange(false);
      callbacks.current.onDirtyChange(false);
    };
  }, [action]);

  useEffect(() => {
    // Never erase a persisted selection while its initial list is still loading or failed.
    if (!loaded || providers.some((provider) => provider.id === selectedId && provider.configured))
      return;
    const nextId = providers.find((provider) => provider.configured)?.id ?? '';
    if (nextId !== selectedId) select(nextId);
  }, [loaded, providers, selectedId, select]);

  return (
    <section className="shared-provider-settings" aria-busy={busy}>
      <h2>模型 Provider</h2>
      <details className="provider-instructions">
        <summary>使用须知</summary>
        {usageNotes}
        <p>
          使用 OpenAI-compatible 协议（非原生 Anthropic）。供应商预设仅填写
          URL，不依赖管理员配置的端点。 填写 API 前缀（例如 /v1），不要填写完整的 /chat/completions
          或 /models 地址；系统自动追加请求路径。
        </p>
        <p>
          支持具体本机或内网 IP（例如 http://127.0.0.1:11434/v1）。HTTP 不加密，仅用于可信网络；
          127.0.0.1 指后端所在机器。域名须使用 HTTPS。
        </p>
        <p>
          密钥由服务端加密存储；API Key
          仅在内存输入，不写入对话。保存发起时立即清空，获取模型或测试失败时保留。 更换供应商或 Base
          URL 必须输入新密钥，不能复用原凭据。
        </p>
        <p>
          获取模型列表和测试会向填写的地址发送 API
          Key；推理连接测试会发送真实请求，可能产生少量费用。
          获取模型列表不等同于推理连接成功；未保存也可测试，测试不会自动保存配置。
        </p>
      </details>
      {notice && <p role="status">{notice}</p>}
      <ProviderSettings
        config={config}
        providers={providers}
        disabled={busy}
        onProvidersChange={setProviders}
        onSelected={select}
        onDirtyChange={dirtyChange}
        action={action}
        onNotice={setNotice}
      />
    </section>
  );
}
