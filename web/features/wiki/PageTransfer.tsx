import { useEffect, useRef, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import { api, type Workspace } from '../../shared/api';
import Modal from '../../shared/ui/Modal';

const MAX_BYTES = 5 * 1024 * 1024;
type PagePackage = {
  format: 'meow.pages.v1';
  version: 1;
  workspace: { name: string; description: string };
  pages: { id: string; title: string; markdown: string; parentId: string | null }[];
};
type Props = {
  workspace: Workspace;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onRefresh: () => Promise<unknown>;
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请检查后手动重试。';
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Reconstruct the allowlisted package: never forward unrelated account or secret fields.
function parsePackage(value: unknown): PagePackage {
  if (
    !isObject(value) ||
    value.format !== 'meow.pages.v1' ||
    value.version !== 1 ||
    !isObject(value.workspace) ||
    typeof value.workspace.name !== 'string' ||
    typeof value.workspace.description !== 'string' ||
    !Array.isArray(value.pages)
  )
    throw new Error('页面包格式无效：需要 meow.pages.v1、version: 1、工作空间信息和 pages 数组。');
  const pages = value.pages.map((page: unknown) => {
    if (
      !isObject(page) ||
      typeof page.id !== 'string' ||
      !page.id ||
      typeof page.title !== 'string' ||
      typeof page.markdown !== 'string' ||
      !(page.parentId === null || typeof page.parentId === 'string')
    )
      throw new Error('页面包中的页面必须包含 id、title、markdown 和 parentId。');
    return { id: page.id, title: page.title, markdown: page.markdown, parentId: page.parentId };
  });
  const ids = new Set(pages.map((page) => page.id));
  if (ids.size !== pages.length) throw new Error('页面包包含重复的页面 ID。');
  if (pages.some((page) => page.parentId !== null && !ids.has(page.parentId)))
    throw new Error('页面包的父页面 ID 必须指向包内页面或为 null。');
  return {
    format: 'meow.pages.v1',
    version: 1,
    workspace: { name: value.workspace.name, description: value.workspace.description },
    pages,
  };
}

export default function PageTransfer({ workspace, onClose, onBusyChange, onRefresh }: Props) {
  const [source, setSource] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<PagePackage | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef(false);
  const imported = useRef(false);
  const close = () => {
    if (!operation.current) onClose();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!operation.current) onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const begin = () => {
    if (operation.current) return false;
    operation.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setNotice('');
    return true;
  };
  const finish = () => {
    operation.current = false;
    setBusy(false);
    onBusyChange(false);
  };
  const updateSource = (text: string) => {
    setSource(text);
    setPreview(null);
    setConfirmation('');
    setError('');
    setNotice('');
    imported.current = false;
  };
  const readFile = async (file: File) => {
    if (!begin()) return;
    try {
      if (file.size > MAX_BYTES) throw new Error('JSON 文件不能超过 5 MiB；原有内容已保留。');
      const text = await file.text();
      updateSource(text);
      setFileName(file.name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      finish();
    }
  };
  const showPreview = () => {
    if (operation.current) return;
    setPreview(null);
    setError('');
    try {
      if (new Blob([source]).size > MAX_BYTES) throw new Error('JSON 内容不能超过 5 MiB。');
      setPreview(parsePackage(JSON.parse(source)));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const exportPages = async () => {
    if (!begin()) return;
    try {
      const result = parsePackage(await api<unknown>('/pages/export', undefined, 'GET'));
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], { type: 'application/json;charset=utf-8' }),
      );
      const link = document.createElement('a');
      try {
        link.href = url;
        link.download = `pages-${encodeURIComponent(workspace.id)}.json`;
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setNotice('已请求浏览器下载页面包，请检查并安全保存文件。未保存的本地草稿不在导出包中。');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      finish();
    }
  };
  const importPages = async () => {
    if (!preview || imported.current || confirmation !== workspace.name || operation.current)
      return;
    if (
      !window.confirm(
        `向目标工作空间“${workspace.name}”追加 ${preview.pages.length} 个页面？所有页面将使用新 ID，不覆盖已有页面。`,
      )
    )
      return;
    if (!begin()) return;
    try {
      const result = await api<{ imported: number; mapping: Record<string, string> }>(
        '/pages/import',
        preview,
        'POST',
      );
      imported.current = true;
      setNotice(`已导入 ${result.imported} 个页面。本地编辑与版本基线未改变。`);
      try {
        await onRefresh();
      } catch (e) {
        setError(`导入已成功，但列表刷新失败：${errorMessage(e)}。请手动刷新，不要重复导入。`);
      }
    } catch (e) {
      setError(
        `${errorMessage(e)} 内容已保留，未自动重试；若请求结果不确定，请先刷新列表核实，避免重复追加。`,
      );
    } finally {
      finish();
    }
  };
  return (
    <Modal
      className="dialog component-dialog"
      aria-labelledby="page-transfer-title"
      onBackdropClick={close}
    >
      <div className="dialog-heading">
        <span className="dialog-icon">
          <Upload size={23} />
        </span>
        <button className="icon-btn" disabled={busy} onClick={close} aria-label="关闭页面包">
          <X size={20} />
        </button>
      </div>
      <h2 id="page-transfer-title">导出 / 导入页面包</h2>
      <p className="dialog-description">
        当前目标工作空间：<strong>{workspace.name}</strong>
      </p>
      <p className="form-hint">
        仅传输页面标题、Markdown、层级与空间名称/描述。不包含用户、权限、密钥、附件或历史。导入使用新
        ID 追加，不覆盖已有页面；弹窗操作不会丢弃 Wiki 草稿，也不会推进编辑器版本基线。
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-hint" role="status">
          {notice}
        </p>
      )}
      <button className="secondary-btn" disabled={busy} onClick={() => void exportPages()}>
        <Download size={16} /> 导出当前空间页面包
      </button>
      <hr />
      <label className="field">
        选择 JSON 文件（最多 5 MiB）
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readFile(file);
            event.target.value = '';
          }}
        />
      </label>
      {fileName && <p className="form-hint">已载入：{fileName}</p>}
      <label className="field">
        或粘贴页面包 JSON（最多 5 MiB）
        <textarea
          rows={6}
          value={source}
          disabled={busy}
          style={{ width: '100%', resize: 'vertical' }}
          onChange={(event) => {
            const text = event.target.value;
            if (new Blob([text]).size > MAX_BYTES) {
              setError('JSON 内容不能超过 5 MiB；原有内容已保留。');
              return;
            }
            updateSource(text);
            setFileName('');
          }}
        />
      </label>
      <button className="secondary-btn" disabled={busy || !source.trim()} onClick={showPreview}>
        检查并预览标题 / 数量
      </button>
      {preview && (
        <div>
          <h3>待导入页面：{preview.pages.length} 个</h3>
          <ul style={{ maxHeight: '20vh', overflowY: 'auto', overflowWrap: 'anywhere' }}>
            {preview.pages.slice(0, 100).map((page) => (
              <li key={page.id}>{page.title || '无标题页面'}</li>
            ))}
          </ul>
          {preview.pages.length > 100 && (
            <p className="form-hint">
              仅展示前 100 个标题；导入包含全部 {preview.pages.length} 个页面。不渲染正文。
            </p>
          )}
          <label className="field">
            输入目标工作空间名称“{workspace.name}”以确认
            <input
              value={confirmation}
              disabled={busy || imported.current}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
        </div>
      )}
      <div className="dialog-actions">
        <button className="secondary-btn" disabled={busy} onClick={close}>
          关闭
        </button>
        <button
          className="primary-btn"
          disabled={
            busy || !preview?.pages.length || confirmation !== workspace.name || imported.current
          }
          onClick={() => void importPages()}
        >
          {busy ? '正在处理…' : '以新 ID 追加导入'}
        </button>
      </div>
    </Modal>
  );
}
