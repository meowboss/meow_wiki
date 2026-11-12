import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import WorkshopWorkspace from './WorkshopWorkspace';
import WorkshopSource from './WorkshopSource';
import WorkshopProjectPicker from './WorkshopProjectPicker';
import WorkbenchActions from './WorkbenchActions';
import { api, type WikiPage } from '../../shared/api';
import ProviderSettings from './ProviderSettings';
import WorkshopChat from './WorkshopChat';
import WorkshopPreview from './WorkshopPreview';
import WorkshopPagePreview from './WorkshopPagePreview';
import {
  projectFile,
  type PageSurface,
  errorMessage,
  providerMetadata,
  type Config,
  type Project,
  type Provider,
  type Validation,
  type WorkshopMessage,
} from './types';
import './workshop.css';

type Props = {
  workspaceId: string | null;
  pages?: WikiPage[];
  renderPagePreview?: (content: string) => ReactNode;
  onOpen?: (id: string) => void;
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
  onInstalled: () => Promise<unknown>;
};
export default function WorkshopView({
  workspaceId,
  pages = [],
  renderPagePreview,
  onOpen = () => {},
  onDirtyChange,
  onBusyChange,
  onInstalled,
}: Props) {
  const [config, setConfig] = useState<Config>({ endpoints: [], configured: false });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<WorkshopMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [content, setContent] = useState('');
  const [providerDirty, setProviderDirty] = useState(false);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pollingError, setPollingError] = useState('');
  const [newKind, setNewKind] = useState<'component' | 'page'>('component');
  const [surface, setSurface] = useState<PageSurface>('home');
  const [fromCurrent, setFromCurrent] = useState(true);
  const [selectedFile, setSelectedFile] = useState('');
  const lifecycle = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const projectRef = useRef<Project | null>(null);
  const reloadRevision = useRef(0);
  const callbacks = useRef({ onDirtyChange, onBusyChange });
  callbacks.current = { onDirtyChange, onBusyChange };
  const file = projectFile(project);
  const fileDirty = !!project && content !== project.files[file];
  const isPage = project?.kind === 'page';
  const dirty = fileDirty || !!draft || providerDirty;
  const projectRunning = project?.state === 'running';
  const running = projectRunning || busy === 'chat';
  const working = loading || !!busy || projectRunning;
  const chosenProvider = providers.find((item) => item.id === providerId);
  // Host endpoint configuration does not gate custom providers; the server authorizes execution.
  const canRun = chosenProvider?.configured === true;

  function acceptProject(next: Project) {
    const nextFile = projectFile(next);
    if (typeof next?.files?.[nextFile] !== 'string')
      throw new Error('项目未返回对应的声明式产物文件。');
    if (workspaceId && next.workspaceId !== workspaceId)
      throw new Error('项目不属于当前工作空间，已阻止加载。');
    const previous = projectRef.current;
    projectRef.current = next;
    setProject(next);
    setContent(next.files[nextFile]);
    setSelectedFile((current) =>
      previous?.id === next.id && current in next.files ? current : nextFile,
    );
    if (previous?.id !== next.id || previous.files[nextFile] !== next.files[nextFile])
      setValidation(null);
    setProjects((current) => [next, ...current.filter((item) => item.id !== next.id)]);
  }
  async function reload(id: string, signal: AbortSignal) {
    const revision = ++reloadRevision.current;
    const [next, history] = await Promise.all([
      api<Project>(`/workshop/projects/${encodeURIComponent(id)}`, undefined, 'GET', signal),
      api<{ messages: WorkshopMessage[] }>(
        `/workshop/projects/${encodeURIComponent(id)}/messages`,
        undefined,
        'GET',
        signal,
      ),
    ]);
    if (signal.aborted || projectRef.current?.id !== id || revision !== reloadRevision.current)
      return;
    acceptProject(next);
    setMessages(
      history.messages
        .filter((item) => item.projectId === id)
        .sort((a, b) => a.sequence - b.sequence),
    );
    setPollingError('');
  }
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    setLoading(true);
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
        const records = providerResult.providers.map(providerMetadata);
        setProviders(records);
        setProviderId(records.find((item) => item.configured)?.id ?? '');
        setProjects(projectResult.projects.filter((item) => item.workspaceId === workspaceId));
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      // Disconnecting fetch is not server-side cancellation.
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
  useEffect(() => {
    if (!project?.id || !running) return;
    const id = project.id;
    const controller = new AbortController();
    let timer: number | undefined;
    async function poll() {
      try {
        await reload(id, controller.signal);
      } catch {
        if (!controller.signal.aborted)
          setPollingError(
            '执行状态暂时无法刷新，将继续尝试。连接中断不代表服务端已取消；请勿重复发送。',
          );
      }
      if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), 1000);
    }
    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // Reload is intentionally scoped to this project/run; it reads current refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, running]);

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
      if (!signal.aborted) setError(errorMessage(e));
    } finally {
      lock.current = false;
      if (!signal.aborted) setBusy('');
    }
  }
  function send(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || !draft.trim() || !canRun || fileDirty || running) return;
    const submitted = draft.trim();
    void action('chat', async (signal) => {
      let current = projectRef.current;
      if (!current) {
        current = await api<Project>(
          `${newKind === 'page' ? '/workshop/page-projects' : '/workshop/projects'}?workspaceId=${encodeURIComponent(workspaceId)}`,
          {
            name: Array.from(submitted).slice(0, 40).join(''),
            instruction: submitted,
            ...(newKind === 'page' ? { surface, fromCurrent } : {}),
          },
          'POST',
          signal,
        );
        if (signal.aborted) return;
        acceptProject(current);
        setMessages([]);
      }
      const id = current.id;
      setValidation(null);
      // Start polling before waiting for the real, potentially long chat request.
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timer = window.setTimeout(abort, 240_000);
      try {
        const result = await api<{ project: Project; messages: WorkshopMessage[] }>(
          `/workshop/projects/${encodeURIComponent(id)}/chat`,
          { providerId, message: submitted },
          'POST',
          controller.signal,
        );
        if (signal.aborted) return;
        // Consume the authoritative chat response even if the follow-up refresh fails.
        ++reloadRevision.current;
        acceptProject(result.project);
        setMessages(
          result.messages
            .filter((item) => item.projectId === id)
            .sort((a, b) => a.sequence - b.sequence),
        );
        setDraft('');
        await reload(id, signal);
        setNotice('已加载服务端对话与项目状态；产物未自动应用到页面或保存为私有组件。');
      } catch (e) {
        if (signal.aborted) return;
        try {
          await reload(id, signal);
        } catch {
          setPollingError('无法重载执行事件，请点击“刷新对话与项目”核对。');
        }
        throw new Error(
          `发送或执行未确认：${controller.signal.aborted ? '等待超过约 240 秒。' : errorMessage(e)} 已尝试重载真实事件；这不代表服务端已停止，请核对消息后再决定是否重发。`,
        );
      } finally {
        window.clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    });
  }
  function selectProject(id: string) {
    if (
      !id ||
      working ||
      (dirty && !window.confirm('切换项目将放弃未发送的消息或未保存的编辑，确定继续吗？'))
    )
      return;
    void action('open', async (signal) => {
      const next = await api<Project>(
        `/workshop/projects/${encodeURIComponent(id)}`,
        undefined,
        'GET',
        signal,
      );
      if (signal.aborted) return;
      acceptProject(next);
      setMessages([]);
      setDraft('');
      await reload(id, signal);
    });
  }
  async function refreshCurrent() {
    const signal = lifecycle.current?.signal;
    if (!project || !signal || signal.aborted || fileDirty) return;
    try {
      await reload(project.id, signal);
    } catch (e) {
      if (!signal.aborted) setPollingError(errorMessage(e));
    }
  }
  async function cancelRun() {
    const signal = lifecycle.current?.signal;
    if (!project || cancelling || !signal || signal.aborted) return;
    setCancelling(true);
    try {
      await api(`/workshop/projects/${encodeURIComponent(project.id)}/cancel`, {}, 'POST', signal);
      if (!signal.aborted) {
        setNotice(
          '已发送取消请求；只有服务端事件与状态确认后才算停止。中止本页网络请求不等于取消执行。',
        );
        await reload(project.id, signal);
      }
    } catch (e) {
      if (!signal.aborted) setError(errorMessage(e));
    } finally {
      if (!signal.aborted) setCancelling(false);
    }
  }
  function saveFile() {
    if (!project || !fileDirty || running) return;
    void action('save', async (signal) => {
      await api(
        `/workshop/projects/${encodeURIComponent(project.id)}/file`,
        { path: file, content, ...(isPage ? { expectedRevision: project.revision } : {}) },
        'PUT',
        signal,
      );
      await reload(project.id, signal);
      if (!signal.aborted) setNotice('声明式 JSON 已保存，请重新校验。');
    });
  }
  function validate() {
    if (!project || fileDirty || running) return;
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
  function install() {
    if (
      !project ||
      isPage ||
      fileDirty ||
      running ||
      !(project.state === 'ready' || validation?.valid)
    )
      return;
    void action('install', async (signal) => {
      const component = await api<{ id: string; name?: string }>(
        `/workshop/projects/${encodeURIComponent(project.id)}/install`,
        {},
        'POST',
        signal,
      );
      if (signal.aborted) return;
      setNotice(
        `已保存为私有组件：${component.name || component.id}。未自动安装到首页、公开发布或审核。`,
      );
      try {
        await onInstalled();
      } catch {
        setError('组件已保存，但列表刷新失败，请手动刷新；不要重复保存。');
      }
      await reload(project.id, signal);
    });
  }
  function applyPage() {
    if (
      !project ||
      !isPage ||
      fileDirty ||
      running ||
      !(project.state === 'ready' || validation?.valid)
    )
      return;
    if (!window.confirm(`确认将此项目应用到 ${project.sourceSurface} 页面？当前页面布局将被替换。`))
      return;
    void action('apply', async (signal) => {
      await api(
        `/workshop/projects/${encodeURIComponent(project.id)}/apply`,
        { expectedProjectRevision: project.revision },
        'POST',
        signal,
      );
      if (signal.aborted) return;
      setNotice('页面已应用。项目文件保存与页面应用是独立操作。');
      await onInstalled();
      await reload(project.id, signal);
    });
  }
  return (
    <section className="workshop-view" aria-label="对话式组件工坊">
      <header className="workshop-heading">
        <h1>组件工坊</h1>
        <details className="workshop-intro">
          <summary>使用说明</summary>
          <p>描述需求 → 对话追问与受限工具执行 → 安全预览 → 明确保存私有组件。</p>
          <p>只生成声明式组件，不执行自定义代码。密钥不能放进对话或文件。</p>
        </details>
      </header>
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
      {loading && <p role="status">正在加载工坊配置…</p>}
      {!workspaceId && <p className="workshop-warning">请先选择工作空间，再开始组件对话。</p>}
      <WorkshopProjectPicker
        project={project}
        projects={projects}
        working={working}
        workspaceId={workspaceId}
        kind={newKind}
        surface={surface}
        fromCurrent={fromCurrent}
        onKindChange={setNewKind}
        onSurfaceChange={setSurface}
        onFromCurrentChange={setFromCurrent}
        onSelect={selectProject}
        onNew={() => {
          if (dirty && !window.confirm('新建对话将放弃未发送消息或未保存编辑，确定继续吗？'))
            return;
          projectRef.current = null;
          setProject(null);
          setMessages([]);
          setDraft('');
          setContent('');
          setSelectedFile('');
          setValidation(null);
          setPollingError('');
          setError('');
          setNotice('');
        }}
        onRefresh={() =>
          void action('refresh-projects', async (signal) => {
            const result = await api<{ projects: Project[] }>(
              `/workshop/projects?workspaceId=${encodeURIComponent(workspaceId || '')}`,
              undefined,
              'GET',
              signal,
            );
            if (!signal.aborted)
              setProjects(result.projects.filter((item) => item.workspaceId === workspaceId));
          })
        }
      />
      <WorkshopWorkspace
        chat={
          <WorkshopChat
            project={project}
            messages={messages}
            draft={draft}
            onDraftChange={setDraft}
            providers={providers}
            providerId={providerId}
            onProviderChange={setProviderId}
            disabled={loading || (!!busy && busy !== 'chat') || !workspaceId || fileDirty}
            canSend={canRun}
            running={running}
            cancelling={cancelling}
            pollingError={pollingError}
            onSend={send}
            onCancel={() => void cancelRun()}
            onRefresh={() => void refreshCurrent()}
          />
        }
        preview={
          isPage ? (
            <section className="workshop-preview" aria-label="页面安全预览">
              <h2>页面安全预览</h2>
              {(running || fileDirty) && (
                <p className="workshop-warning">当前展示最近保存的页面；未保存 JSON 不进入预览。</p>
              )}
              {renderPagePreview ? (
                renderPagePreview(project?.files[file] ?? '')
              ) : (
                <p>页面预览渲染器尚未连接；可在源码中检查页面，项目不会自动应用。</p>
              )}
            </section>
          ) : (
            <WorkshopPreview
              content={project?.files[file] ?? ''}
              pages={pages}
              onOpen={onOpen}
              stale={running || fileDirty}
            />
          )
        }
        source={
          project ? (
            <WorkshopSource
              path={selectedFile || file}
              content={
                !selectedFile || selectedFile === file
                  ? content
                  : (project.files[selectedFile] ?? '')
              }
              editable={!selectedFile || selectedFile === file}
              page={isPage}
              working={working}
              dirty={fileDirty}
              onChange={(value) => {
                setContent(value);
                setValidation(null);
              }}
              onSave={saveFile}
            />
          ) : (
            <p>开始对话后可查看项目文件。</p>
          )
        }
        files={Object.keys(project?.files ?? {})}
        selectedFile={selectedFile}
        onSelectFile={setSelectedFile}
        title={project?.name ?? (newKind === 'page' ? '页面工作区' : '组件工作区')}
        busy={working}
      />
      <div className="workshop-configuration" aria-label="组件保存与工坊设置">
        {project && (
          <WorkbenchActions
            project={project}
            validation={validation}
            working={working}
            fileDirty={fileDirty}
            onValidate={validate}
            onInstall={install}
            onApply={applyPage}
          />
        )}
        <ProviderSettings
          config={config}
          providers={providers}
          disabled={working}
          onProvidersChange={setProviders}
          onSelected={setProviderId}
          onDirtyChange={setProviderDirty}
          action={action}
          onNotice={setNotice}
        />
        <aside className="workshop-boundary" aria-label="工坊能力边界">
          <details>
            <summary>开发边界</summary>
            <p>
              受控 Agent，不是通用代码 IDE。只读虚拟 SDK：/sdk/README.md 和
              /sdk/component.schema.json。唯一可写文件 {file}（最多 30000 字符）；最多 8
              轮受限工具执行。不提供 shell、任意网络或主机文件访问，不执行自定义
              JavaScript。工具事件只显示服务端安全摘要，不呈现原始敏感输出或模型思考。
            </p>
            <strong>只读 SDK / 声明式组件契约</strong>
            <p>
              name（1–160 字符）、description（最多 500 字符）、template（惰性文本或 Markdown，最多
              10000 字符）；可选 blocks 最多 20 项，仅支持 markdown/text、page-list/title 和
              search/title。最终以服务端校验为准。密钥不能放进对话或文件。刷新、断开与请求超时不等于取消运行；请核对服务端真实状态。
            </p>
          </details>
        </aside>
      </div>
    </section>
  );
}
