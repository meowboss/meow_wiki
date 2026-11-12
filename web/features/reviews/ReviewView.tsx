import { useEffect, useState } from 'react';
import { api, type WikiComponent, type WikiPage } from '../../shared/api';
import ComponentRenderer from '../../shared/components/ComponentRenderer';
export default function ReviewView({
  userId,
  pages,
  onOpen,
  refresh,
  onBusyChange,
  onDirtyChange,
}: {
  userId: string;
  pages: WikiPage[];
  onOpen: (id: string) => void;
  refresh: () => Promise<unknown>;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [releases, setReleases] = useState<WikiComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const dirty = Object.values(reason).some((value) => value.length > 0);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const c = new AbortController();
    void api<{ releases: WikiComponent[] }>('/reviews', undefined, 'GET', c.signal)
      .then((r) => {
        if (!c.signal.aborted) setReleases(r.releases);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, []);
  async function load() {
    setError('');
    setLoading(true);
    try {
      setReleases((await api<{ releases: WikiComponent[] }>('/reviews')).releases);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }
  async function decide(c: WikiComponent, decision: 'published' | 'rejected') {
    if (busy) return;
    if (
      !window.confirm(
        `确认${decision === 'published' ? '发布' : '拒绝'}“${c.name}” v${c.version}？`,
      )
    )
      return;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      await api(`/reviews/${encodeURIComponent(c.id)}`, { decision, reason: reason[c.id] ?? '' });
      setReleases((current) => current.filter((r) => r.id !== c.id));
      setReason((current) => {
        const next = { ...current };
        delete next[c.id];
        return next;
      });
      setNotice('审核决定已保存。');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '审核失败');
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <div className="catalog-view">
      <div className="section-heading">
        <div>
          <h1>
            组件审核<span className="heading-dot">.</span>
          </h1>
          <p>审核独立发行快照；管理员不能审核自己的组件。</p>
        </div>
        <button className="secondary-btn" disabled={busy || loading} onClick={() => void load()}>
          刷新审核列表
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p role="status">正在加载审核队列…</p>
      ) : !releases.length ? (
        <div className="empty-state">
          <h3>暂无待审核发行版</h3>
        </div>
      ) : (
        releases.map((c) => (
          <article className="home-component" key={c.id}>
            <header>
              <strong>
                {c.name} · v{c.version}
              </strong>
              <span>待审核</span>
            </header>
            <p>{c.description}</p>
            <ComponentRenderer component={c} pages={pages} onOpen={onOpen} />
            <details>
              <summary>声明式页面模板</summary>
              <pre className="template-preview">{c.template}</pre>
            </details>
            <label className="field">
              审核意见
              <textarea
                maxLength={2000}
                disabled={busy}
                value={reason[c.id] ?? ''}
                onChange={(e) => setReason((current) => ({ ...current, [c.id]: e.target.value }))}
              />
            </label>
            {c.authorId === userId && <p>不能审核自己的发行版。</p>}
            <div className="dialog-actions">
              <button
                className="secondary-btn"
                disabled={busy || c.authorId === userId}
                onClick={() => void decide(c, 'rejected')}
              >
                拒绝
              </button>
              <button
                className="primary-btn"
                disabled={busy || c.authorId === userId}
                onClick={() => void decide(c, 'published')}
              >
                通过并发布
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}
