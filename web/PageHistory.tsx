import { useEffect, useState } from 'react';
import { Clock3, LoaderCircle, X } from 'lucide-react';
import { api, type PageRevision } from './api';

type Props = { pageId: string; busy: boolean; conflict: boolean; onClose: () => void; onRestore: (revision: number) => void };

export default function PageHistory({ pageId, busy, conflict, onClose, onRestore }: Props) {
  const [revisions, setRevisions] = useState<PageRevision[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setRevisions([]); setSelected(null);
    void api<{ revisions: PageRevision[] }>(`/pages/${encodeURIComponent(pageId)}/history`, undefined, 'GET', controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        const ordered = [...result.revisions].sort((a, b) => b.revision - a.revision);
        setRevisions(ordered); setSelected(ordered[0]?.revision ?? null);
      })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '加载历史失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [pageId, reload]);
  const revision = revisions.find(r => r.revision === selected);
  return <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }}>
    <section className="dialog component-dialog" role="dialog" aria-modal="true" aria-labelledby="history-title" onClick={e => e.stopPropagation()}>
      <div className="dialog-heading"><span className="dialog-icon"><Clock3 size={23}/></span><button className="icon-btn" disabled={busy} onClick={onClose} aria-label="关闭页面历史"><X size={20}/></button></div>
      <h2 id="history-title">页面版本历史</h2>
      <p className="dialog-description">预览为纯文本；恢复会创建新版本，不会删除已有历史。</p>
      {loading ? <div className="inline-state"><LoaderCircle className="spin" size={22}/>正在加载历史…</div> : error ? <div role="alert"><p className="form-error">{error}</p><button className="text-btn" onClick={() => setReload(v => v + 1)}>重新加载历史</button></div> : !revision ? <p>暂无历史版本。</p> : <>
        <label className="field">选择版本<select value={selected ?? ''} onChange={e => setSelected(Number(e.target.value))} style={{ padding: 10, maxWidth: '100%' }}>{revisions.map(r => <option key={r.revision} value={r.revision}>v{r.revision} · {r.operation} · {new Date(r.updatedAt).toLocaleString('zh-CN')}</option>)}</select></label>
        <p className="form-hint">操作人：{revision.actorId} · 操作：{revision.operation} · 父页面：{revision.parentId || '无'}{revision.deletedAt ? ' · 已删除版本' : ''}</p>
        <h3 style={{ overflowWrap: 'anywhere' }}>{revision.title}</h3>
        <pre className="template-preview" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '35vh', overflowY: 'auto' }}>{revision.markdown}</pre>
        {conflict && <p className="form-error" role="alert">页面版本已冲突。本地编辑仍保留，请关闭历史并明确加载最新页面后再恢复。</p>}
        <div className="dialog-actions"><button className="secondary-btn" disabled={busy} onClick={onClose}>关闭</button><button className="primary-btn" disabled={busy || conflict} onClick={() => onRestore(revision.revision)}>恢复此版本</button></div>
      </>}
    </section>
  </div>;
}
