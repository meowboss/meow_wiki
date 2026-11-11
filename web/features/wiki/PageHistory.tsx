import { useEffect, useRef, useState } from 'react';
import { Clock3, LoaderCircle, X } from 'lucide-react';
import { api, ApiError, type PageRevision, type WikiPage } from '../../shared/api';

type Props = {
  pageId: string;
  busy: boolean;
  conflict: boolean;
  onClose: () => void;
  onRestore: (revision: number) => void;
};

type HistoryExport = {
  format: string;
  page: WikiPage;
  revisions: PageRevision[];
  exportedAt: string;
  digest: string;
};

type ExportSnapshot = { pageId: string; revision: number; digest: string };

export default function PageHistory({ pageId, busy, conflict, onClose, onRestore }: Props) {
  const [revisions, setRevisions] = useState<PageRevision[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [localBusy, setLocalBusy] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [notice, setNotice] = useState('');
  const [snapshot, setSnapshot] = useState<ExportSnapshot | null>(null);
  const [saved, setSaved] = useState(false);
  const [keep, setKeep] = useState(10);
  // The ref closes the gap before React renders disabled buttons after a click.
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    setSnapshot(null);
    setSaved(false);
    setOperationError('');
    setNotice('');
    setLocalBusy(false);
    return () => {
      operation.current?.abort();
      operation.current = null;
    };
  }, [pageId]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setRevisions([]);
    setSelected(null);
    void api<{ revisions: PageRevision[] }>(
      `/pages/${encodeURIComponent(pageId)}/history`,
      undefined,
      'GET',
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        const ordered = [...result.revisions].sort((a, b) => b.revision - a.revision);
        setRevisions(ordered);
        setSelected(ordered[0]?.revision ?? null);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '加载历史失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [pageId, reload]);
  const revision = revisions.find((r) => r.revision === selected);
  const disabled = busy || conflict || localBusy || loading;
  const keepOptions = [10, 25, 50, 100].filter((count) => count <= revisions.length);
  const selectedKeep = keepOptions.includes(keep) ? keep : (keepOptions[0] ?? 0);
  const currentSnapshot = snapshot?.pageId === pageId ? snapshot : null;
  const close = () => {
    if (!busy && !operation.current) onClose();
  };
  const exportHistory = async () => {
    if (disabled || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setLocalBusy(true);
    setSnapshot(null);
    setSaved(false);
    setOperationError('');
    setNotice('');
    try {
      const result = await api<HistoryExport>(
        `/pages/${encodeURIComponent(pageId)}/history/export`,
        undefined,
        'GET',
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (
        result.page?.id !== pageId ||
        !Number.isSafeInteger(result.page.revision) ||
        !result.digest ||
        !Array.isArray(result.revisions)
      ) {
        throw new Error('导出快照数据无效，请重新导出。');
      }
      const blob = new Blob([JSON.stringify(result, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      try {
        link.href = url;
        link.download = `page-${encodeURIComponent(pageId)}-history-v${result.page.revision}.json`;
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        // Allow the browser to consume the download URL before releasing it.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setSnapshot({ pageId, revision: result.page.revision, digest: result.digest });
      setNotice('已请求浏览器下载导出文件；这不保证文件已落盘。请检查文件后再确认安全保存。');
    } catch (e) {
      if (!controller.signal.aborted)
        setOperationError(e instanceof Error ? e.message : '导出历史失败');
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setLocalBusy(false);
      }
    }
  };
  const archiveHistory = async () => {
    if (
      disabled ||
      operation.current ||
      !currentSnapshot ||
      !saved ||
      !selectedKeep ||
      selectedKeep >= revisions.length
    )
      return;
    if (
      !window.confirm(
        `将永久清理最旧的历史版本，仅保留最近 ${selectedKeep} 个版本。此操作不可撤销。请确认你已检查并安全保存导出文件。`,
      )
    )
      return;
    const controller = new AbortController();
    operation.current = controller;
    setLocalBusy(true);
    setOperationError('');
    setNotice('');
    try {
      await api(
        `/pages/${encodeURIComponent(pageId)}/history/archive`,
        {
          expectedRevision: currentSnapshot.revision,
          keep: selectedKeep,
          exportDigest: currentSnapshot.digest,
        },
        'POST',
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSnapshot(null);
      setSaved(false);
      setNotice(`历史清理成功，已保留最近 ${selectedKeep} 个版本。再次清理前必须重新导出。`);
      setReload((value) => value + 1);
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof ApiError && e.status === 409) {
        setSnapshot(null);
        setSaved(false);
        setOperationError(
          '历史快照已变化（409），本次未清理历史，也不会自动重试。请重新导出并检查保存后再操作。',
        );
      } else {
        setOperationError(e instanceof Error ? e.message : '清理历史失败');
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setLocalBusy(false);
      }
    }
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="dialog component-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        aria-busy={localBusy || loading}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <span className="dialog-icon">
            <Clock3 size={23} />
          </span>
          <button
            className="icon-btn"
            disabled={busy || localBusy}
            onClick={close}
            aria-label="关闭页面历史"
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="history-title">页面版本历史</h2>
        <p className="dialog-description">预览为纯文本；恢复会创建新版本，不会删除已有历史。</p>
        {operationError && (
          <p className="form-error" role="alert">
            {operationError}
          </p>
        )}
        {notice && (
          <p className="form-hint" role="status">
            {notice}
          </p>
        )}
        {loading ? (
          <div className="inline-state">
            <LoaderCircle className="spin" size={22} />
            正在加载历史…
          </div>
        ) : error ? (
          <div role="alert">
            <p className="form-error">{error}</p>
            <button
              className="text-btn"
              disabled={disabled}
              onClick={() => setReload((v) => v + 1)}
            >
              重新加载历史
            </button>
          </div>
        ) : !revision ? (
          <p>暂无历史版本。</p>
        ) : (
          <>
            <label className="field">
              选择版本
              <select
                value={selected ?? ''}
                disabled={localBusy}
                onChange={(e) => setSelected(Number(e.target.value))}
                style={{ padding: 10, maxWidth: '100%' }}
              >
                {revisions.map((r) => (
                  <option key={r.revision} value={r.revision}>
                    v{r.revision} · {r.operation} · {new Date(r.updatedAt).toLocaleString('zh-CN')}
                  </option>
                ))}
              </select>
            </label>
            <p className="form-hint">
              操作人：{revision.actorId} · 操作：{revision.operation} · 父页面：
              {revision.parentId || '无'}
              {revision.deletedAt ? ' · 已删除版本' : ''}
            </p>
            <h3 style={{ overflowWrap: 'anywhere' }}>{revision.title}</h3>
            <pre
              className="template-preview"
              style={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: '35vh',
                overflowY: 'auto',
              }}
            >
              {revision.markdown}
            </pre>
            <fieldset disabled={disabled} style={{ minWidth: 0 }}>
              <legend>导出与永久清理历史</legend>
              <p className="form-hint">
                先导出 JSON，再检查并安全保存。下载请求不保证文件已落盘；digest
                只是快照校验，不证明已备份。
              </p>
              <button className="secondary-btn" onClick={() => void exportHistory()}>
                {localBusy ? '正在处理…' : '导出历史 JSON'}
              </button>
              {currentSnapshot && (
                <p className="form-hint" style={{ overflowWrap: 'anywhere' }}>
                  导出页面版本：v{currentSnapshot.revision} · digest：{currentSnapshot.digest}
                </p>
              )}
              <label className="field">
                <span>
                  <input
                    type="checkbox"
                    checked={saved}
                    disabled={disabled || !currentSnapshot}
                    onChange={(e) => setSaved(e.target.checked)}
                  />{' '}
                  我已检查并安全保存导出文件
                </span>
              </label>
              <label className="field">
                保留最近版本数（当前共 {revisions.length} 个）
                <select
                  value={selectedKeep || ''}
                  disabled={disabled || !keepOptions.length}
                  onChange={(e) => setKeep(Number(e.target.value))}
                  style={{ padding: 10, maxWidth: '100%' }}
                >
                  {!keepOptions.length && <option value="">历史不足 10 个，不可清理</option>}
                  {keepOptions.map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
              <p className="form-hint">永久删除最旧版本，仅保留最近所选数量，无法撤销。</p>
              <button
                className="secondary-btn"
                disabled={
                  disabled ||
                  !currentSnapshot ||
                  !saved ||
                  !selectedKeep ||
                  selectedKeep >= revisions.length
                }
                onClick={() => void archiveHistory()}
              >
                永久清理最旧历史
              </button>
            </fieldset>
            {conflict && (
              <p className="form-error" role="alert">
                页面版本已冲突。本地编辑仍保留，请关闭历史并明确加载最新页面后再恢复。
              </p>
            )}
            <div className="dialog-actions">
              <button className="secondary-btn" disabled={busy || localBusy} onClick={close}>
                关闭
              </button>
              <button
                className="primary-btn"
                disabled={disabled}
                onClick={() => {
                  if (!disabled && !operation.current) onRestore(revision.revision);
                }}
              >
                恢复此版本
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
