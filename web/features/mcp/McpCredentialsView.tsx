import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type DomainRole } from '../../shared/api';
import './mcp.css';

type MemberDomain = { id: string; name: string; role: DomainRole };
type McpScope = 'domain.read' | 'domain.contribute';
const canContribute = (role?: DomainRole) =>
  role === 'contributor' || role === 'maintainer' || role === 'owner';
const scopes: Record<McpScope, string> = {
  'domain.read': '只读（domain.read）',
  'domain.contribute': '提交待审贡献（domain.contribute）',
};
type Credential = {
  scope: McpScope;
  id: string;
  domainId: string;
  label: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
};
type Props = {
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
};
const message = (error: unknown) => (error instanceof Error ? error.message : '请求失败，请重试。');
const timestamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};
// Keep only public metadata, even if a server accidentally returns extra fields.
function credential(value: unknown): Credential {
  if (!value || typeof value !== 'object') throw new Error('凭据记录格式无效。');
  const item = value as Record<string, unknown>;
  if (
    !['id', 'domainId', 'label', 'expiresAt', 'createdAt'].every(
      (key) => typeof item[key] === 'string',
    ) ||
    !(item.revokedAt === null || typeof item.revokedAt === 'string') ||
    !(item.scope === 'domain.read' || item.scope === 'domain.contribute')
  )
    throw new Error('凭据记录格式无效。');
  return {
    scope: item.scope,
    id: item.id as string,
    domainId: item.domainId as string,
    label: item.label as string,
    expiresAt: item.expiresAt as string,
    createdAt: item.createdAt as string,
    revokedAt: item.revokedAt as string | null,
  };
}

export default function McpCredentialsView({ onDirtyChange, onBusyChange }: Props) {
  const [domains, setDomains] = useState<MemberDomain[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [domainId, setDomainId] = useState('');
  const [scope, setScope] = useState<McpScope>('domain.read');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState('7');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const callbacks = useRef({ onDirtyChange, onBusyChange });
  callbacks.current = { onDirtyChange, onBusyChange };
  const lifecycle = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const working = loading || !!busy;
  const contributionAllowed = canContribute(domains.find((domain) => domain.id === domainId)?.role);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    void Promise.all([
      api<{ domains: MemberDomain[] }>('/domains', undefined, 'GET', controller.signal),
      api<{ credentials: unknown[] }>('/mcp/credentials', undefined, 'GET', controller.signal),
    ])
      .then(([domainResult, credentialResult]) => {
        if (controller.signal.aborted) return;
        if (
          !Array.isArray(domainResult?.domains) ||
          !domainResult.domains.every(
            (item) =>
              typeof item.id === 'string' &&
              typeof item.name === 'string' &&
              ['reader', 'contributor', 'maintainer', 'owner'].includes(item.role),
          ) ||
          !Array.isArray(credentialResult?.credentials)
        )
          throw new Error('域或凭据列表格式无效。');
        const records = credentialResult.credentials.map(credential);
        setDomains(domainResult.domains.map(({ id, name, role }) => ({ id, name, role })));
        setDomainId(domainResult.domains[0]?.id ?? '');
        setCredentials(records);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      callbacks.current.onDirtyChange(false);
      callbacks.current.onBusyChange(false);
      // Token state belongs only to this mounted view; no persistence or URL state.
    };
  }, []);
  useEffect(() => {
    callbacks.current.onBusyChange(working);
  }, [working]);

  function clearToken() {
    setToken('');
    setCopyMessage('');
    callbacks.current.onDirtyChange(false);
  }
  async function issue(event: FormEvent) {
    event.preventDefault();
    const expiresInDays = Number(days);
    if (working || lock.current || token) return;
    if (!domains.some((domain) => domain.id === domainId) || !label.trim()) {
      setError('请选择成员域并填写凭据名称。');
      return;
    }
    if (scope === 'domain.contribute' && !contributionAllowed) {
      setError('仅贡献者、维护者或所有者可签发提交待审贡献的凭据。');
      return;
    }
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) {
      setError('有效期必须为 1 至 30 天的整数。');
      return;
    }
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted) return;
    lock.current = true;
    setBusy('issue');
    setError('');
    setCopyMessage('');
    try {
      const result = await api<{ token: string; record: unknown }>(
        '/mcp/credentials',
        { domainId, label: label.trim(), expiresInDays, scope },
        'POST',
        signal,
      );
      if (signal.aborted) return;
      if (typeof result?.token !== 'string' || !result.token) {
        throw new Error('签发接口未返回令牌。请刷新核对凭据列表，必要时撤销后重新签发。');
      }
      // Preserve the one-time secret even if its accompanying metadata is malformed.
      setToken(result.token);
      callbacks.current.onDirtyChange(true);
      const record = credential(result.record);
      setCredentials((current) => [record, ...current.filter((item) => item.id !== record.id)]);
      setLabel('');
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      lock.current = false;
      if (!signal.aborted) setBusy('');
    }
  }
  async function revoke(record: Credential) {
    if (working || lock.current || record.revokedAt) return;
    if (!window.confirm(`撤销“${record.label}”后，使用它的 Agent 将无法继续访问。确定撤销吗？`))
      return;
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted) return;
    lock.current = true;
    setBusy(record.id);
    setError('');
    try {
      await api<unknown>(
        `/mcp/credentials/${encodeURIComponent(record.id)}`,
        undefined,
        'DELETE',
        signal,
      );
      if (signal.aborted) return;
      setCredentials((current) =>
        current.map((item) =>
          item.id === record.id ? { ...item, revokedAt: new Date().toISOString() } : item,
        ),
      );
      clearToken();
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      lock.current = false;
      if (!signal.aborted) setBusy('');
    }
  }
  async function copyToken() {
    const signal = lifecycle.current?.signal;
    if (!token || !signal || signal.aborted) return;
    setCopyMessage('');
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error('当前浏览器无法访问剪贴板，请手动选择并复制令牌。');
      await navigator.clipboard.writeText(token);
      if (!signal.aborted)
        setCopyMessage('已复制。关闭此处不会清除系统剪贴板，请妥善保管并及时清理。');
    } catch {
      if (!signal.aborted)
        setCopyMessage('复制失败：浏览器不支持或拒绝了剪贴板访问，请手动选择并复制令牌。');
    }
  }

  return (
    <section className="mcp-view" aria-label="Agent 连接">
      <header>
        <h1>Agent 连接</h1>
        <p>为 Agent 签发单个知识域的只读或提交待审贡献 MCP 凭据；默认只读。</p>
      </header>
      <aside className="mcp-boundary">
        <h2>连接与访问边界</h2>
        <ul>
          <li>
            端点：<code>/mcp</code>，传输方式：<strong>Streamable HTTP</strong>。
          </li>
          <li>
            在支持自定义请求头的 MCP 客户端中配置 <code>Authorization: Bearer &lt;token&gt;</code>。
          </li>
          <li>读取范围仅限所选知识域中已发布的内容；不读取原工作空间的私人页面或资料。</li>
          <li>
            domain.contribute 在只读能力外仅可提交
            pending（待审核）贡献，绝不能发布或审核；即使签发者是维护者或所有者也不例外。
          </li>
          <li>服务器仍仅监听 localhost，只能在本机连接；签发凭据不会开启远程访问。</li>
          <li>当前接口不支持 OAuth；没有 OAuth 登录或授权流程。</li>
        </ul>
      </aside>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">正在加载成员域与凭据…</p>}
      <form className="mcp-panel" onSubmit={(event) => void issue(event)}>
        <h2>签发凭据</h2>
        <fieldset disabled={working || !!token}>
          <label>
            成员域
            <select
              required
              value={domainId}
              onChange={(event) => {
                setDomainId(event.target.value);
                setScope('domain.read');
              }}
            >
              <option value="">请选择知识域</option>
              {domains.map((domain) => (
                <option key={domain.id} value={domain.id}>
                  {domain.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            权限范围（scope）
            <select value={scope} onChange={(event) => setScope(event.target.value as McpScope)}>
              <option value="domain.read">{scopes['domain.read']}</option>
              <option value="domain.contribute" disabled={!contributionAllowed}>
                {scopes['domain.contribute']}
              </option>
            </select>
          </label>
          <p>
            仅贡献者、维护者或所有者可签发 contribute；只读成员不可签发。contribute
            只能提交待审，不能发布或审核。
          </p>
          <label>
            凭据名称
            <input
              required
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="例如：本机研究 Agent"
            />
          </label>
          <label>
            有效期（天）
            <input
              type="number"
              required
              min={1}
              max={30}
              step={1}
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
          </label>
          <button className="primary-btn" disabled={!domainId || !label.trim()}>
            {busy === 'issue'
              ? '签发中…'
              : scope === 'domain.contribute'
                ? '签发待审贡献凭据'
                : '签发只读凭据'}
          </button>
        </fieldset>
        {!loading && !domains.length && <p>尚无可用成员域，请先加入或创建知识域。</p>}
      </form>
      {token && (
        <section className="mcp-panel mcp-secret" aria-label="一次性令牌">
          <h2>令牌仅展示这一次</h2>
          <p>
            请立即复制到可信客户端。关闭、离开页面、切换空间或退出后，无法再次查看明文。不要分享或提交到代码仓库。
          </p>
          <label>
            令牌
            <textarea readOnly value={token} rows={3} spellCheck={false} autoComplete="off" />
          </label>
          <div className="mcp-actions">
            <button type="button" className="primary-btn" onClick={() => void copyToken()}>
              复制令牌
            </button>
            <button type="button" className="text-btn" onClick={clearToken}>
              关闭并清除明文
            </button>
          </div>
          {copyMessage && <p role="status">{copyMessage}</p>}
        </section>
      )}
      <section className="mcp-panel" aria-label="已签发凭据">
        <h2>已签发凭据</h2>
        <p>仅展示名称、域、权限范围和生命周期信息，不展示令牌或其哈希。关闭明文不会撤销凭据。</p>
        {!loading && !credentials.length && <p>暂无凭据。</p>}
        <ul className="mcp-credentials">
          {credentials.map((record) => {
            const expired = new Date(record.expiresAt).getTime() <= Date.now();
            return (
              <li key={record.id}>
                <div>
                  <strong>{record.label}</strong>
                  <p>权限范围：{scopes[record.scope]}</p>
                  <p>
                    域：
                    {domains.find((domain) => domain.id === record.domainId)?.name ??
                      '不可用的知识域'}
                  </p>
                  <p>
                    创建：{timestamp(record.createdAt)} · 到期：{timestamp(record.expiresAt)}
                  </p>
                  <p>
                    {record.revokedAt
                      ? `已撤销：${timestamp(record.revokedAt)}`
                      : expired
                        ? '已过期'
                        : '有效'}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-btn"
                  disabled={working || !!record.revokedAt}
                  onClick={() => void revoke(record)}
                >
                  {busy === record.id ? '撤销中…' : record.revokedAt ? '已撤销' : '撤销'}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}
