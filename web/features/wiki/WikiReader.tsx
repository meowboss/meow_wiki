import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Clock3, LoaderCircle, PencilLine, Puzzle } from 'lucide-react';
import type { WikiPage } from '../../shared/api';
import './reader.css';

export type WikiReaderProps = {
  page: WikiPage;
  pages: WikiPage[];
  html: string;
  rendering: boolean;
  renderError: string;
  markdownEnabled: boolean;
  busy: string;
  onEdit: () => void;
  onOpenHistory: () => void;
  onDelete: () => void;
  onOpenMarket: () => void;
  onRetryPreview: () => void;
  onOpen: (id: string) => void;
};

const dateLabel = (date: string) => {
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? '尚未更新' : value.toLocaleString('zh-CN');
};

export default function WikiReader({
  page,
  pages,
  html,
  rendering,
  renderError,
  markdownEnabled,
  busy,
  onEdit,
  onOpenHistory,
  onDelete,
  onOpenMarket,
  onRetryPreview,
  onOpen,
}: WikiReaderProps) {
  const [fontSize, setFontSize] = useState(18);
  const [focused, setFocused] = useState(false);
  const focusButtonRef = useRef<HTMLButtonElement>(null);
  const parent = pages.find((candidate) => candidate.id === page.parentId);

  useEffect(() => {
    if (!focused) return;
    document.body.classList.add('wiki-reader-focus-active');
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector('[role="dialog"], dialog[open]')
      ) {
        return;
      }
      setFocused(false);
      focusButtonRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('wiki-reader-focus-active');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [focused]);

  return (
    <section
      className={`wiki-reader${focused ? ' wiki-reader-focused' : ''}`}
      aria-label="页面阅读"
      style={{ '--wiki-reader-font-size': `${fontSize}px` } as CSSProperties}
    >
      <div className="wiki-reader-toolbar">
        <div className="wiki-reader-actions">
          <button type="button" className="primary-btn" disabled={!!busy} onClick={onEdit}>
            <PencilLine size={15} />
            编辑页面
          </button>
          <button type="button" className="text-btn" disabled={!!busy} onClick={onOpenHistory}>
            历史
          </button>
          <button type="button" className="text-btn" disabled={!!busy} onClick={onDelete}>
            删除页面
          </button>
        </div>
        <div className="wiki-reader-controls">
          <label className="wiki-reader-font">
            字号
            <select
              aria-label="阅读字号"
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
            >
              {[16, 18, 20].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button
            ref={focusButtonRef}
            type="button"
            className="text-btn wiki-reader-focus-toggle"
            aria-pressed={focused}
            title={focused ? '退出专注模式（Esc）' : '专注阅读'}
            onClick={() => setFocused((value) => !value)}
          >
            {focused ? '退出专注' : '专注模式'}
          </button>
        </div>
      </div>
      <article className="wiki-reader-article">
        <header className="wiki-reader-heading">
          {parent && (
            <button
              type="button"
              className="text-btn wiki-reader-parent"
              disabled={!!busy}
              onClick={() => onOpen(parent.id)}
            >
              父页面：{parent.title}
            </button>
          )}
          <h1>{page.title}</h1>
          <div className="wiki-reader-meta">
            <Clock3 size={13} />
            <span>
              更新于 <time dateTime={page.updatedAt}>{dateLabel(page.updatedAt)}</time>
            </span>
            <span>·</span>
            <span>版本 v{page.revision}</span>
          </div>
        </header>
        <div className="wiki-reader-content" aria-busy={rendering}>
          {!markdownEnabled ? (
            <div className="inline-state">
              <Puzzle size={25} />
              <p>Markdown 插件尚未启用</p>
              <button type="button" className="text-btn" onClick={onOpenMarket} disabled={!!busy}>
                前往插件市场启用 <ArrowRight size={13} />
              </button>
            </div>
          ) : renderError ? (
            <div className="inline-state error-text" role="alert">
              <p>{renderError}</p>
              <button type="button" className="text-btn" onClick={onRetryPreview} disabled={!!busy}>
                重试预览
              </button>
            </div>
          ) : rendering ? (
            <div className="inline-state" role="status">
              <LoaderCircle className="spin" size={24} />
              <p>正在安全渲染…</p>
            </div>
          ) : html ? (
            // The server supplies sanitized HTML, matching the editor preview boundary.
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div className="inline-state">
              <p>页面暂无正文</p>
            </div>
          )}
        </div>
      </article>
    </section>
  );
}
