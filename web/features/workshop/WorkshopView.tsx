import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../../shared/api';
import './workshop.css';

type Endpoint = { id: string; label: string };
type Config = { endpoints: Endpoint[]; configured: boolean };
type Provider = {
  id: string;
  label: string;
  endpointId: string;
  model: string;
  configured: boolean;
};
type Project = {
  id: string;
  name: string;
  instruction: string;
  state: string;
  iterations: number;
  error?: string | null;
  files: { '/project/component.json': string };
  workspaceId: string;
};
type Validation = { valid: boolean; issues?: unknown[] };
type Props = {
  workspaceId: string | null;
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
};
const FILE = '/project/component.json' as const;
const message = (error: unknown) => (error instanceof Error ? error.message : '请求失败，请重试。');
// Pick public metadata only: never keep an unexpected credential field from a response.
function metadata(provider: Provider): Provider {
  return {
    id: provider.id,
    label: provider.label,
    endpointId: provider.endpointId,
    model: provider.model,
    configured: provider.configured === true,
  };
}

export default function WorkshopView({ workspaceId, onDirtyChange, onBusyChange }: Props) {
  const [config, setConfig] = useState<Config>({ endpoints: [], configured: false });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  const [label, setLabel] = useState('');
  const [endpointId, setEndpointId] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [providerId, setProviderId] = useState('');
  const [validation, setValidation] = useState<Validation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lifecycle = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const callbacks = useRef({ onDirtyChange, onBusyChange });
  callbacks.current = { onDirtyChange, onBusyChange };
  const fileDirty = !!project && content !== project.files[FILE];
  const dirty = fileDirty || !!(name || instruction || label || model || apiKey);
  const working = loading || !!busy;
  const endpointsReady = config.configured && config.endpoints.length > 0;
  const chosenProvider = providers.find((item) => item.id === providerId);
  const canRun =
    endpointsReady &&
    chosenProvider?.configured &&
    config.endpoints.some((item) => item.id === chosenProvider.endpointId);
  const projectRunning = project?.state === 'running';

  function acceptProject(next: Project) {
    if (typeof next?.files?.[FILE] !== 'string')
      throw new Error('项目未返回唯一的声明式组件文件。');
    setProject(next);
    setContent(next.files[FILE]);
    setValidation(null);
    setProjects((current) => [next, ...current.filter((item) => item.id !== next.id)]);
  }
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    void Promise.all([
      api<Config>('/workshop/config', undefined, 'GET', controller.signal),
      api<{ providers: Provider[] }>('/workshop/providers', undefined, 'GET', controller.signal),
      workspaceId
        ? api<{ projects: Project[] }>(
            `/workshop/projects?workspaceId=${encodeURIComponent(workspaceId)}`,
            undefined,
            'GET',
            controller.signal,
          )
        : Promise.resolve({ projects: [] as Project[] }),
    ])
      .then(([configuration, providerResult, projectResult]) => {
        if (controller.signal.aborted) return;
        setConfig(configuration);
        setEndpointId(configuration.endpoints[0]?.id ?? '');
        const records = providerResult.providers.map(metadata);
        setProviders(records);
        setProviderId(records.find((item) => item.configured)?.id ?? '');
        setProjects(projectResult.projects);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      callbacks.current.onDirtyChange(false);
      callbacks.current.onBusyChange(false);
    };
  }, [workspaceId]);
  useEffect(() => {
    callbacks.current.onDirtyChange(dirty);
  }, [dirty]);
  useEffect(() => {
    callbacks.current.onBusyChange(working);
  }, [working]);

  async function action(key: string, task: (signal: AbortSignal) => Promise<void>) {
    const signal = lifecycle.current?.signal;
    if (lock.current || working || !signal || signal.aborted) return;
    lock.current = true;
    setBusy(key);
    callbacks.current.onBusyChange(true);
    setError('');
    setNotice('');
    try {
      await task(signal);
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    } finally {
      lock.current = false;
      if (!signal.aborted) setBusy('');
    }
  }
  function saveProvider(event: FormEvent) {
    event.preventDefault();
    if (
      !endpointsReady ||
      !label.trim() ||
      !model.trim() ||
      !apiKey.trim() ||
      !config.endpoints.some((item) => item.id === endpointId)
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
        const record = metadata(result);
        setProviders((current) => [record, ...current.filter((item) => item.id !== record.id)]);
        setProviderId(record.id);
        setLabel('');
        setModel('');
        setNotice('Provider 已保存，仅保留元数据；密钥输入已清除。');
      } catch {
        throw new Error(
          'Provider 保存未确认。密钥输入已清除，请刷新 Provider 列表核对后再试；不会展示可能包含密钥的服务错误。',
        );
      }
    });
  }
  function createProject(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || !name.trim() || !instruction.trim()) return;
    if (fileDirty && !window.confirm('创建项目将放弃当前未保存的 JSON，确定继续吗？')) return;
    void action('create', async (signal) => {
      const result = await api<Project>(
        '/workshop/projects',
        { name: name.trim(), instruction: instruction.trim() },
        'POST',
        signal,
      );
      if (signal.aborted) return;
      acceptProject(result);
      setName('');
      setInstruction('');
      setNotice('项目已创建；尚未调用模型。');
    });
  }
  function selectProject(id: string) {
    if (
      !id ||
      working ||
      (fileDirty && !window.confirm('切换项目将放弃未保存的 JSON，确定继续吗？'))
    )
      return;
    void action('open', async (signal) => {
      const result = await api<Project>(
        `/workshop/projects/${encodeURIComponent(id)}`,
        undefined,
        'GET',
        signal,
      );
      if (!signal.aborted) acceptProject(result);
    });
  }
  function saveFile() {
    if (!project || !fileDirty || projectRunning) return;
    const id = project.id;
    const submitted = content;
    void action('save', async (signal) => {
      await api(
        `/workshop/projects/${encodeURIComponent(id)}/file`,
        { path: FILE, content: submitted },
        'PUT',
        signal,
      );
      const result = await api<Project>(
        `/workshop/projects/${encodeURIComponent(id)}`,
        undefined,
        'GET',
        signal,
      );
      if (!signal.aborted) {
        acceptProject(result);
        setNotice('声明式 JSON 已保存。');
      }
    });
  }
  function validate() {
    if (!project || fileDirty || projectRunning) return;
    void action('validate', async (signal) => {
      const result = await api<Validation>(
        `/workshop/projects/${encodeURIComponent(project.id)}/validate`,
        {},
        'POST',
        signal,
      );
      if (!signal.aborted) setValidation(result);
    });
  }
  function run() {
    if (!project || fileDirty || !canRun || projectRunning) return;
    const id = project.id;
    void action('run', async (signal) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timer = window.setTimeout(abort, 240_000);
      setValidation(null);
      try {
        const result = await api<Project>(
          `/workshop/projects/${encodeURIComponent(id)}/run`,
          { providerId },
          'POST',
          controller.signal,
        );
        if (!signal.aborted) {
          acceptProject(result);
          if (result.state === 'failed')
            setError(result.error || '生成失败，服务未提供原因。请检查 Provider 与项目后重试。');
          else setNotice('运行请求已返回，以下为服务端实际项目状态；未自动安装或发布。');
        }
      } catch (e) {
        if (!signal.aborted)
          throw new Error(
            `运行未确认：${controller.signal.aborted ? '等待超过约 240 秒。' : message(e)} 不代表服务端已停止，请先“刷新当前项目”核对状态，勿重复提交。`,
          );
      } finally {
        window.clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    });
  }
  function install() {
    if (!project || fileDirty || !validation?.valid || projectRunning) return;
    void action('install', async (signal) => {
      const component = await api<{ id: string; name?: string }>(
        `/workshop/projects/${encodeURIComponent(project.id)}/install`,
        {},
        'POST',
        signal,
      );
      if (!signal.aborted)
        setNotice(`已导入私有组件：${component.name || component.id}。未上架市场，未自动审核。`);
    });
  }

  return (
    <section className="workshop-view" aria-label="声明式组件工坊">
      <header className="workshop-heading">
        <span className="workshop-eyebrow">CONTROLLED COMPONENT WORKSHOP</span>
        <h1>组件工坊</h1>
        <p>从需求生成受控的声明式组件，校验后导入私有组件。这里不是通用代码 IDE。</p>
      </header>
      <aside className="workshop-boundary" aria-label="工坊能力边界">
        <strong>
          唯一文件：<code>{FILE}</code>
        </strong>
        <p>
          只编辑声明式 JSON，不执行自定义 JavaScript，不提供 shell、任意网络请求或其它文件访问。
        </p>
        <details>
          <summary>只读 SDK / 声明式组件契约</summary>
          <p>
            模型可读取虚拟 SDK 文档 /sdk/README.md 和
            /sdk/component.schema.json；两者只读，不是主机文件。唯一可写路径为 {FILE}，最多 30000
            字符。禁止把密钥放进文件。
          </p>
          <p>
            JSON 字段：name（1–160 字符）、description（最多 500 字符）、template（惰性文本或
            Markdown，最多 10000 字符）；可选 blocks 最多 20
            项。未知字段、脚本、导入和可执行代码均拒绝。
          </p>
          <pre className="workshop-issues">{`blocks 只允许以下声明：
{ "type": "markdown", "text": "Markdown 文本（最多 10000 字符）" }
{ "type": "page-list", "title": "标题（最多 160 字符）" }
{ "type": "search", "title": "标题（最多 160 字符）" }`}</pre>
          <p>
            markdown 使用 text；page-list 与 search 使用
            title。组件由宿主受控渲染；没有自定义网络、shell
            或任意文件能力。最终以服务端校验结果为准。
          </p>
        </details>
        <p>
          真实模型调用最多 8 轮；单次运行等待约 240
          秒。导入仅创建私有组件，不会自动上架市场或通过审核。
        </p>
      </aside>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="workshop-notice" role="status">
          {notice}
        </p>
      )}
      {working && (
        <p role="status">
          {loading
            ? '正在加载工坊配置…'
            : busy === 'run'
              ? '正在请求真实模型，最多 8 轮；请等待服务端结果…'
              : '正在处理请求…'}
        </p>
      )}
      {!loading && !endpointsReady && (
        <p className="workshop-warning" role="status">
          服务端未配置可用模型端点。Provider 保存和模型运行已禁用；不会模拟 AI
          生成。请联系管理员配置端点后重新进入工坊。
        </p>
      )}
      <div className="workshop-columns">
        <section className="workshop-panel" aria-labelledby="workshop-providers">
          <h2 id="workshop-providers">模型 Provider</h2>
          <p>
            只选择服务端允许的端点，不接受自定义 URL。API Key 仅在本页内存中输入，提交后立即清空。
          </p>
          <form onSubmit={saveProvider}>
            <fieldset disabled={working}>
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
                disabled={
                  !endpointsReady || !endpointId || !label.trim() || !model.trim() || !apiKey.trim()
                }
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
                  disabled={working}
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
                        setProviders((current) =>
                          current.filter((item) => item.id !== provider.id),
                        );
                        if (providerId === provider.id) setProviderId('');
                      }
                    });
                  }}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
          {!loading && !providers.length && <p>尚无 Provider。填写真实凭据后才能运行模型。</p>}
          <button
            className="text-btn"
            disabled={working}
            onClick={() =>
              void action('refresh-providers', async (signal) => {
                const result = await api<{ providers: Provider[] }>(
                  '/workshop/providers',
                  undefined,
                  'GET',
                  signal,
                );
                if (!signal.aborted) setProviders(result.providers.map(metadata));
              })
            }
          >
            刷新 Provider 列表
          </button>
        </section>
        <section className="workshop-panel" aria-labelledby="workshop-projects">
          <h2 id="workshop-projects">项目</h2>
          {!workspaceId && <p>请先选择工作空间，再创建或打开项目。</p>}
          <form onSubmit={createProject}>
            <fieldset disabled={working || !workspaceId}>
              <label>
                项目名称
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={120}
                />
              </label>
              <label>
                组件需求
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={4}
                  maxLength={3000}
                  required
                />
              </label>
              <button className="primary-btn" disabled={!name.trim() || !instruction.trim()}>
                创建项目
              </button>
            </fieldset>
          </form>
          <label>
            选择项目
            <select
              value={project?.id ?? ''}
              disabled={working || !workspaceId}
              onChange={(e) => selectProject(e.target.value)}
            >
              <option value="">选择已有项目</option>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="text-btn"
            disabled={working || !workspaceId}
            onClick={() =>
              void action('refresh-projects', async (signal) => {
                const result = await api<{ projects: Project[] }>(
                  '/workshop/projects',
                  undefined,
                  'GET',
                  signal,
                );
                if (!signal.aborted) setProjects(result.projects);
              })
            }
          >
            刷新项目列表
          </button>
        </section>
      </div>
      {project && (
        <section className="workshop-panel workshop-editor" aria-labelledby="workshop-editor">
          <h2 id="workshop-editor">{project.name}</h2>
          <p>需求：{project.instruction}</p>
          <p role="status">
            服务端状态：<strong>{project.state}</strong> · 已执行轮次：{project.iterations} / 8
            {fileDirty ? ' · JSON 未保存' : ' · JSON 已保存'}
          </p>
          {project.state === 'failed' && (
            <p className="form-error" role="alert">
              生成失败：
              {project.error || '服务端未提供失败原因。没有生成成功的保证，请检查配置与需求。'}
            </p>
          )}
          {projectRunning && (
            <p className="workshop-warning">
              服务端仍在运行，请刷新当前项目核对；运行期间不可编辑或重复运行。
            </p>
          )}
          <label>
            声明式组件 JSON（{FILE}）
            <textarea
              className="workshop-json"
              maxLength={30000}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setValidation(null);
              }}
              spellCheck={false}
              disabled={working || projectRunning}
              rows={18}
            />
          </label>
          <div className="workshop-actions">
            <button
              className="primary-btn"
              disabled={working || !fileDirty || projectRunning}
              onClick={saveFile}
            >
              保存 JSON
            </button>
            <button
              className="secondary-btn"
              disabled={working || fileDirty || projectRunning}
              onClick={validate}
            >
              校验组件
            </button>
            <button
              className="text-btn"
              disabled={working}
              onClick={() => selectProject(project.id)}
            >
              刷新当前项目
            </button>
          </div>
          {fileDirty && <p>请先保存 JSON，再校验、运行或导入。校验结果仅对应已保存的文件。</p>}
          {validation && (
            <div role="status">
              <strong>{validation.valid ? '校验通过' : '校验未通过'}</strong>
              {validation.issues && (
                <pre className="workshop-issues">{JSON.stringify(validation.issues, null, 2)}</pre>
              )}
            </div>
          )}
          <label>
            运行使用的 Provider
            <select
              value={providerId}
              disabled={working}
              onChange={(e) => setProviderId(e.target.value)}
            >
              <option value="">选择 Provider</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label} · {provider.model}
                </option>
              ))}
            </select>
          </label>
          <div className="workshop-actions">
            <button
              className="primary-btn"
              disabled={working || fileDirty || !canRun || projectRunning}
              onClick={run}
            >
              运行模型生成
            </button>
            <button
              className="secondary-btn"
              disabled={working || fileDirty || !validation?.valid || projectRunning}
              onClick={install}
            >
              导入私有组件
            </button>
          </div>
          <p>导入前需校验通过；导入不等于安装到首页、公开发布或市场审核。</p>
        </section>
      )}
    </section>
  );
}
