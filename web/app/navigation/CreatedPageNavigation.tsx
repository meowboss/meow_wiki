import { useEffect, useRef } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import './navigation.css';
import './created-pages.css';

export type CreatedPageNavigationProps = {
  pages: { id: string; title: string }[];
  selectedId?: string;
  onOpen: (id: string) => void;
  disabled: boolean;
  loading?: boolean;
};

export default function CreatedPageNavigation({
  pages,
  selectedId,
  onOpen,
  disabled,
  loading = false,
}: CreatedPageNavigationProps) {
  const details = useRef<HTMLDetailsElement>(null);
  const active = pages.some((page) => page.id === selectedId);
  const status = loading ? '正在加载创作页面…' : '暂无创作页面，请去组件工坊创建。';

  useEffect(() => {
    if (active && details.current) details.current.open = true;
  }, [active, selectedId]);

  return (
    <nav
      className="main-nav primary-navigation created-page-navigation"
      aria-label="创作页面"
      aria-busy={loading}
    >
      <details ref={details} className="primary-navigation__group">
        <summary
          className="primary-navigation__summary"
          data-active={active || undefined}
          title="创作页面"
          aria-label="创作页面"
        >
          <FileText size={18} aria-hidden="true" />
          <span>创作页面</span>
          <ChevronDown size={16} className="primary-navigation__chevron" aria-hidden="true" />
        </summary>
        <div className="primary-navigation__children">
          {loading || pages.length === 0 ? (
            <p className="created-page-navigation__status" role="status" title={status}>
              {status}
            </p>
          ) : (
            pages.map((page) => (
              <button
                key={page.id}
                type="button"
                className="primary-navigation__item"
                aria-label={page.title}
                title={page.title}
                aria-current={page.id === selectedId ? 'page' : undefined}
                disabled={disabled}
                onClick={() => onOpen(page.id)}
              >
                <FileText size={18} aria-hidden="true" />
                <span>{page.title}</span>
              </button>
            ))
          )}
        </div>
      </details>
    </nav>
  );
}
