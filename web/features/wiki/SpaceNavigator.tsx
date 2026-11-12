import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, FileText, Plus, Search } from 'lucide-react';
import type { WikiPage, WorkspaceData } from '../../shared/api';
import SpaceManagement from './SpaceManagement';
import { pageRows } from './space-tree';
import './space-navigator.css';

export type SpaceNavigatorProps = {
  workspaceName: string;
  pages: WikiPage[];
  trash: WikiPage[];
  selectedId: string;
  plugins: WorkspaceData['plugins'];
  busy: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRestore: (id: string) => void;
  onTogglePlugin: (id: string, enabled: boolean) => void;
};

const tabs = [
  { id: 'pages', label: '笔记目录' },
  { id: 'management', label: '空间管理' },
] as const;
type Tab = (typeof tabs)[number]['id'];
const COMPACT_QUERY = '(max-width: 1100px)';

export default function SpaceNavigator({
  workspaceName,
  pages,
  trash,
  selectedId,
  plugins,
  busy,
  onOpen,
  onCreate,
  onRestore,
  onTogglePlugin,
}: SpaceNavigatorProps) {
  const id = useId();
  const [tab, setTab] = useState<Tab>('pages');
  const [query, setQuery] = useState('');
  const [wide, setWide] = useState(false);
  const [expanded, setExpanded] = useState(
    () => typeof window !== 'undefined' && !window.matchMedia(COMPACT_QUERY).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY);
    const sync = () => {
      setExpanded(!media.matches);
      if (media.matches) setWide(false);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const rows = useMemo(() => pageRows(pages), [pages]);
  const search = query.trim().toLocaleLowerCase();
  const visibleRows = useMemo(
    () => rows.filter(({ page }) => page.title.toLocaleLowerCase().includes(search)),
    [rows, search],
  );
  const openPage = (pageId: string) => {
    onOpen(pageId);
    if (window.matchMedia(COMPACT_QUERY).matches) setExpanded(false);
  };

  return (
    <aside
      className={`space-navigator${wide && tab === 'pages' ? ' space-navigator-wide' : ''}`}
      aria-label="知识空间导航"
    >
      <details
        open={expanded}
        onToggle={(event) => {
          if (event.target === event.currentTarget) setExpanded(event.currentTarget.open);
        }}
      >
        <summary className="space-navigator-summary">
          <span>空间导航</span>
          <span className="space-navigator-expand">{expanded ? '收起导航' : '展开导航'}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="space-navigator-body">
          <div className="space-navigator-heading">
            <small>所属空间</small>
            <strong>{workspaceName}</strong>
          </div>
          <div className="space-navigator-tabs" role="tablist" aria-label="空间导航页签">
            {tabs.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${id}-tab-${item.id}`}
                aria-controls={`${id}-panel-${item.id}`}
                aria-selected={tab === item.id}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => {
                  let next = index;
                  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                  else if (event.key === 'ArrowLeft')
                    next = (index + tabs.length - 1) % tabs.length;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = tabs.length - 1;
                  else return;
                  event.preventDefault();
                  setTab(tabs[next].id);
                  document.getElementById(`${id}-tab-${tabs[next].id}`)?.focus();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <section
            className="space-navigator-panel"
            role="tabpanel"
            id={`${id}-panel-pages`}
            aria-labelledby={`${id}-tab-pages`}
            hidden={tab !== 'pages'}
          >
            <div className="space-navigator-actions">
              <button
                className="space-navigator-create"
                type="button"
                disabled={busy}
                onClick={onCreate}
              >
                <Plus size={15} aria-hidden="true" />
                新建笔记
              </button>
              <button
                className="space-navigator-resize"
                type="button"
                aria-pressed={wide}
                onClick={() => setWide((value) => !value)}
              >
                {wide ? '收起目录' : '展开目录'}
              </button>
            </div>
            <label className="space-navigator-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                aria-label="搜索笔记标题"
                placeholder="搜索笔记标题"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <nav className="space-navigator-directory" aria-label="笔记目录">
              <ul className="space-navigator-pages">
                {visibleRows.map(({ page, depth }) => (
                  <li key={page.id} style={{ paddingInlineStart: `${depth * 12}px` }}>
                    <button
                      type="button"
                      aria-current={page.id === selectedId ? 'page' : undefined}
                      onClick={() => openPage(page.id)}
                      title={page.title || '未命名笔记'}
                    >
                      <FileText size={16} aria-hidden="true" />
                      <span>{page.title || '未命名笔记'}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {!visibleRows.length && (
                <p className="space-navigator-empty">{search ? '没有匹配的笔记' : '暂无笔记'}</p>
              )}
            </nav>
          </section>
          <section
            className="space-navigator-panel"
            role="tabpanel"
            id={`${id}-panel-management`}
            aria-labelledby={`${id}-tab-management`}
            hidden={tab !== 'management'}
          >
            <SpaceManagement
              pages={pages}
              trash={trash}
              plugins={plugins}
              busy={busy}
              selectedId={selectedId}
              onOpen={openPage}
              onRestore={onRestore}
              onTogglePlugin={onTogglePlugin}
              onShowPages={() => {
                setQuery('');
                setTab('pages');
              }}
            />
          </section>
        </div>
      </details>
    </aside>
  );
}
