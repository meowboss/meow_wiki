import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Eye,
  FileText,
  LoaderCircle,
  PanelLeftClose,
  PencilLine,
  Puzzle,
  ShieldCheck,
  Sprout,
} from 'lucide-react';
import type { WikiPage } from '../../shared/api';

export type WikiEditorMode = 'split' | 'edit' | 'preview';

export type WikiEditorProps = {
  page: WikiPage;
  pages: WikiPage[];
  title: string;
  markdown: string;
  parentId: string | null;
  baseRevision: number | null;
  dirty: boolean;
  conflict: boolean;
  busy: string;
  mode: WikiEditorMode;
  markdownEnabled: boolean;
  html: string;
  rendering: boolean;
  renderError: string;
  onTitleChange: (title: string) => void;
  onMarkdownChange: (markdown: string) => void;
  onParentIdChange: (parentId: string | null) => void;
  onModeChange: (mode: WikiEditorMode) => void;
  onOpenHistory: () => void;
  onLoadLatest: () => void;
  onDelete: () => void;
  onSave: () => void;
  onOpenMarket: () => void;
  onRetryPreview: () => void;
};

const dateLabel = (date: string) => {
  const d = new Date(date);
  return Number.isNaN(d.getTime())
    ? '尚未更新'
    : d.toLocaleString('zh-CN', {
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
};

// Controlled view: the owner retains the editor snapshot, CAS baseline and dirty guards.
export default function WikiEditor({
  page,
  pages,
  title,
  markdown,
  parentId,
  baseRevision,
  dirty,
  conflict,
  busy,
  mode,
  markdownEnabled,
  html,
  rendering,
  renderError,
  onTitleChange,
  onMarkdownChange,
  onParentIdChange,
  onModeChange,
  onOpenHistory,
  onLoadLatest,
  onDelete,
  onSave,
  onOpenMarket,
  onRetryPreview,
}: WikiEditorProps) {
  return (
    <section className="editor-card">
      <div className="document-heading">
        <div className="document-path">
          <span className="document-icon">
            <FileText size={19} />
          </span>
          <span>知识笔记</span>
          <ChevronRight size={13} />
          <strong>{page.title}</strong>
        </div>
        <span className={`save-status ${dirty ? 'unsaved' : ''}`}>
          {dirty ? <span className="unsaved-dot" /> : <Check size={13} />}{' '}
          {dirty ? '有未保存更改' : '已保存'}
        </span>
      </div>
      <div className="document-title">
        <input
          aria-label="页面标题"
          disabled={!!busy}
          maxLength={200}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="无标题页面"
        />
        <div className="document-meta">
          <Clock3 size={13} />
          更新于 {dateLabel(page.updatedAt)}
          <span className="meta-separator">·</span>
          <span>{markdown.length.toLocaleString()} 字符</span>
          <span className="document-tag">Markdown · v{baseRevision}</span>
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            marginTop: 12,
          }}
        >
          父页面
          <select
            aria-label="父页面"
            disabled={!!busy}
            value={parentId ?? ''}
            onChange={(e) => onParentIdChange(e.target.value || null)}
            style={{
              maxWidth: '70%',
              padding: '6px 10px',
              border: '1px solid #deded8',
              borderRadius: 6,
              background: 'transparent',
            }}
          >
            <option value="">无（顶层页面）</option>
            {parentId && !pages.some((p) => p.id === parentId) && (
              <option value={parentId}>原父页面（已删除或不可访问）</option>
            )}
            {pages
              .filter((p) => p.id !== page.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title || '无标题页面'}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="editor-toolbar">
        <div className="mode-tabs" aria-label="编辑模式">
          <button className={mode === 'edit' ? 'active' : ''} onClick={() => onModeChange('edit')}>
            <PencilLine size={14} />
            编辑
          </button>
          <button
            className={mode === 'split' ? 'active' : ''}
            onClick={() => onModeChange('split')}
          >
            <PanelLeftClose size={14} />
            分屏
          </button>
          <button
            className={mode === 'preview' ? 'active' : ''}
            onClick={() => onModeChange('preview')}
          >
            <Eye size={14} />
            预览
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <button className="text-btn" disabled={!!busy} onClick={onOpenHistory}>
            历史
          </button>
          <button className="text-btn" disabled={!!busy} onClick={onLoadLatest}>
            加载最新
          </button>
          <button className="text-btn" disabled={!!busy || conflict} onClick={onDelete}>
            删除
          </button>
          <button
            className="save-btn"
            onClick={onSave}
            disabled={!!busy || conflict || !dirty || !title.trim()}
          >
            {busy === 'save' ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
            保存页面
          </button>
        </div>
      </div>
      <div className={`editor-panels mode-${mode}`}>
        {mode !== 'preview' && (
          <div className="source-panel">
            <div className="panel-label">
              <span>
                <Code2 size={13} />
                MARKDOWN
              </span>
              <span>纯文本，专注表达</span>
            </div>
            <textarea
              aria-label="Markdown 内容"
              disabled={!!busy}
              spellCheck={false}
              value={markdown}
              onChange={(e) => onMarkdownChange(e.target.value)}
              placeholder="# 从一个想法开始…"
            />
          </div>
        )}
        {mode !== 'edit' && (
          <div className="preview-panel">
            <div className="panel-label">
              <span>
                <Eye size={13} />
                实时预览
              </span>
              <span className="live-indicator">
                <span />
                安全渲染
              </span>
            </div>
            {!markdownEnabled ? (
              <div className="inline-state">
                <Puzzle size={25} />
                <p>Markdown 插件尚未启用</p>
                <button className="text-btn" onClick={onOpenMarket}>
                  前往插件市场启用 <ArrowRight size={13} />
                </button>
              </div>
            ) : renderError ? (
              <div className="inline-state error-text" role="alert">
                <CircleHelp size={24} />
                <p>{renderError}</p>
                <button className="text-btn" onClick={onRetryPreview}>
                  重试预览
                </button>
              </div>
            ) : rendering ? (
              <div className="inline-state">
                <LoaderCircle className="spin" size={24} />
                <p>正在安全渲染…</p>
              </div>
            ) : html ? (
              <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <div className="inline-state">
                <PencilLine size={24} />
                <p>写点什么，预览会在这里生长。</p>
              </div>
            )}
          </div>
        )}
      </div>
      <footer className="editor-footer">
        <span>
          <ShieldCheck size={12} />
          预览仅使用服务端净化后的 HTML
        </span>
        <span>
          好想法，值得被记录 <Sprout size={13} />
        </span>
      </footer>
    </section>
  );
}
