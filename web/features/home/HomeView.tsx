import { useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type HomeBlock,
  type HomeData,
  type WikiComponent,
  type WorkspaceData,
} from '../../shared/api';
import ComponentRenderer from '../../shared/components/ComponentRenderer';

type Props = {
  data: WorkspaceData;
  onOpen: (id: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
};
export default function HomeView({ data, onOpen, onDirtyChange, onBusyChange }: Props) {
  const [baseline, setBaseline] = useState<HomeData | null>(null);
  const [title, setTitle] = useState('我的首页');
  const [blocks, setBlocks] = useState<HomeBlock[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [choice, setChoice] = useState('');
  const dirty =
    baseline !== null &&
    (title !== (baseline.layout?.title ?? '我的首页') ||
      JSON.stringify(blocks) !== JSON.stringify(baseline.layout?.blocks ?? []));
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(
    () => () => {
      onDirtyChange(false);
      onBusyChange(false);
    },
    [onDirtyChange, onBusyChange],
  );
  function apply(next: HomeData) {
    setBaseline(next);
    setTitle(next.layout?.title ?? '我的首页');
    setBlocks(next.layout?.blocks ?? []);
    setConflict(false);
  }
  useEffect(() => {
    const c = new AbortController();
    void api<HomeData>('/home', undefined, 'GET', c.signal)
      .then((next) => {
        if (!c.signal.aborted) apply(next);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : '加载失败');
      });
    return () => c.abort();
  }, []);
  const options = [
    ...data.components.map((c) => ({
      key: `draft:${c.id}`,
      label: `私有 · ${c.name}`,
      block: { componentId: c.id } as HomeBlock,
    })),
    ...(data.installed ?? []).map((i) => ({
      key: `release:${i.releaseId}`,
      label: `已安装 · ${i.release.name} v${i.release.version}`,
      block: { releaseId: i.releaseId } as HomeBlock,
    })),
  ];
  function resolve(block: HomeBlock): WikiComponent | null {
    const index =
      baseline?.layout?.blocks.findIndex((b) => JSON.stringify(b) === JSON.stringify(block)) ?? -1;
    if (index >= 0) return baseline?.components[index] ?? null;
    return (
      (block.componentId
        ? data.components.find((c) => c.id === block.componentId)
        : data.installed?.find((i) => i.releaseId === block.releaseId)?.release) ?? null
    );
  }
  async function save() {
    if (!baseline || busy || conflict || !title.trim()) return;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setNotice('');
    try {
      const next = await api<HomeData>(
        '/home',
        { title: title.trim(), blocks, expectedRevision: baseline.revision },
        'PUT',
      );
      apply(next);
      setNotice('首页布局已保存。');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setError(
          '首页布局版本冲突：本地布局已保留，未自动重试。请复制需要保留的信息后加载最新布局。',
        );
      } else setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function reload() {
    if (busy || (dirty && !window.confirm('加载最新布局会放弃本地未保存的首页更改，确定继续吗？')))
      return;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      apply(await api<HomeData>('/home'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  function move(index: number, delta: number) {
    setBlocks((current) => {
      const next = [...current];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  }
  return (
    <div className="catalog-view home-view">
      <div className="section-heading">
        <div>
          <div className="eyebrow">YOUR WORKSPACE HOME</div>
          <h1>
            首页<span className="heading-dot">.</span>
          </h1>
          <p>用私有组件和已安装发行版，安排当前空间的知识入口。</p>
        </div>
        <button
          className="primary-btn"
          disabled={!baseline || busy || conflict || !dirty || !title.trim()}
          onClick={() => void save()}
        >
          保存布局{dirty ? ' *' : ''}
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!baseline ? (
        <div className="empty-state">
          <p>正在加载首页…</p>
          <button className="secondary-btn" onClick={() => void reload()}>
            重新加载
          </button>
        </div>
      ) : (
        <>
          <div className="home-controls">
            <label className="field">
              首页标题
              <input
                maxLength={160}
                value={title}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="home-add">
              <select
                aria-label="可添加组件"
                value={choice}
                disabled={busy || blocks.length >= 12}
                onChange={(e) => setChoice(e.target.value)}
              >
                <option value="">选择私有或已安装组件</option>
                {options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                className="secondary-btn"
                disabled={busy || !choice || blocks.length >= 12}
                onClick={() => {
                  const option = options.find((o) => o.key === choice);
                  if (option) setBlocks((current) => [...current, option.block]);
                }}
              >
                添加组件
              </button>
              <button className="text-btn" disabled={busy} onClick={() => void reload()}>
                加载最新布局
              </button>
            </div>
            <small>
              最多 12 个组件 · 基于布局版本 {baseline.revision}
              {dirty ? ' · 有未保存更改' : ''}
            </small>
          </div>
          <h2>{title || '我的首页'}</h2>
          {!blocks.length && (
            <div className="empty-state">
              <h3>这里还没有组件</h3>
              <p>从上方添加私有或已安装组件，然后保存布局。</p>
            </div>
          )}
          {blocks.map((block, index) => {
            const component = resolve(block);
            return (
              <article
                className="home-component"
                key={`${block.componentId ?? block.releaseId}-${index}`}
              >
                <header>
                  <strong>{component?.name ?? '组件已丢失或不可访问'}</strong>
                  <div>
                    <button
                      className="text-btn"
                      aria-label={`上移组件 ${index + 1}`}
                      disabled={busy || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      上移
                    </button>
                    <button
                      className="text-btn"
                      aria-label={`下移组件 ${index + 1}`}
                      disabled={busy || index === blocks.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      下移
                    </button>
                    <button
                      className="text-btn"
                      disabled={busy}
                      onClick={() => setBlocks((current) => current.filter((_, i) => i !== index))}
                    >
                      删除
                    </button>
                  </div>
                </header>
                {component ? (
                  <ComponentRenderer component={component} pages={data.pages} onOpen={onOpen} />
                ) : (
                  <p className="local-notice">
                    找不到此布局引用。你可以删除此占位，不会自动改变已保存的布局。
                  </p>
                )}
              </article>
            );
          })}
        </>
      )}
    </div>
  );
}
