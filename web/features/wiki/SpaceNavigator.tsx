import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, FileText, Plus, Search } from 'lucide-react';
import type { WikiPage, WorkspaceData } from '../../shared/api';
import './space-navigator.css';

export type SpaceNavigatorProps = {
  workspaceName: string;
  pages: WikiPage[];
  selectedId: string;
  plugins: WorkspaceData['plugins'];
  busy: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onTogglePlugin: (id: string, enabled: boolean) => void;
};

const tabs = [
  { id: 'pages', label: '笔记目录' },
  { id: 'overview', label: '空间概览' },
  { id: 'plugins', label: '插件配置' },
] as const;
type Tab = (typeof tabs)[number]['id'];

function pageRows(pages: WikiPage[]) {
  const ids = new Set(pages.map((page) => page.id));
  const children = new Map<string, WikiPage[]>();
  const roots: WikiPage[] = [];
  for (const page of pages) {
    if (!page.parentId || !ids.has(page.parentId)) roots.push(page);
    else {
      const siblings = children.get(page.parentId) ?? [];
      siblings.push(page);
      children.set(page.parentId, siblings);
    }
  }
  const visited = new Set<string>();
  const rows: { page: WikiPage; depth: number }[] = [];
  const visit = (root: WikiPage) => {
    const stack = [{ page: root, depth: 0 }];
    while (stack.length) {
      const row = stack.pop()!;
      if (visited.has(row.page.id)) continue;
      visited.add(row.page.id);
      rows.push(row);
      const descendants = children.get(row.page.id) ?? [];
      for (let index = descendants.length - 1; index >= 0; index--) {
        stack.push({ page: descendants[index], depth: Math.min(row.depth + 1, 8) });
      }
    }
  };
  roots.forEach(visit);
  // Cycles have no root; start each remaining component without dropping its pages.
  pages.forEach((page) => {
    if (!visited.has(page.id)) visit(page);
  });
  return rows;
}

function updatedTime(page: WikiPage) {
  const value = Date.parse(page.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

export default function SpaceNavigator({
  workspaceName,
  pages,
  selectedId,
  plugins,
  busy,
  onOpen,
  onCreate,
  onTogglePlugin,
}: SpaceNavigatorProps) {
  const id = useId();
  const [tab, setTab] = useState<Tab>('pages');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 801px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 801px)');
    const sync = () => setExpanded(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const rows = useMemo(() => pageRows(pages), [pages]);
  const search = query.trim().toLocaleLowerCase();
  const visibleRows = rows.filter(({ page }) => page.title.toLocaleLowerCase().includes(search));
  const recentPages = useMemo(
    () => [...pages].sort((a, b) => updatedTime(b) - updatedTime(a)).slice(0, 5),
    [pages],
  );
  const topLevelCount = pages.filter((page) => !page.parentId).length;

  return (
    <aside className="space-navigator" aria-label="知识空间导航">
      <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
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
            <button
              className="space-navigator-create"
              type="button"
              disabled={busy}
              onClick={onCreate}
            >
              <Plus size={15} aria-hidden="true" />
              新建笔记
            </button>
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
            <nav aria-label="笔记目录">
              <ul className="space-navigator-pages">
                {visibleRows.map(({ page, depth }) => (
                  <li key={page.id} style={{ paddingInlineStart: `${depth * 12}px` }}>
                    <button
                      type="button"
                      aria-current={page.id === selectedId ? 'page' : undefined}
                      onClick={() => onOpen(page.id)}
                      title={page.title || '未命名笔记'}
                    >
                      <FileText size={14} aria-hidden="true" />
                      <span>{page.title || '未命名笔记'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            {!visibleRows.length && (
              <p className="space-navigator-empty">{search ? '没有匹配的笔记' : '暂无笔记'}</p>
            )}
          </section>
          <section
            className="space-navigator-panel"
            role="tabpanel"
            id={`${id}-panel-overview`}
            aria-labelledby={`${id}-tab-overview`}
            hidden={tab !== 'overview'}
          >
            <dl className="space-navigator-counts">
              <div>
                <dt>笔记总数</dt>
                <dd>{pages.length}</dd>
              </div>
              <div>
                <dt>顶层笔记</dt>
                <dd>{topLevelCount}</dd>
              </div>
            </dl>
            <button
              className="space-navigator-create"
              type="button"
              onClick={() => {
                setQuery('');
                setTab('pages');
              }}
            >
              查看全部笔记
            </button>
            <h3>最近更新</h3>
            <ul className="space-navigator-pages space-navigator-recent">
              {recentPages.map((page) => (
                <li key={page.id}>
                  <button
                    type="button"
                    aria-current={page.id === selectedId ? 'page' : undefined}
                    onClick={() => onOpen(page.id)}
                  >
                    <span>{page.title || '未命名笔记'}</span>
                    <small>
                      {updatedTime(page)
                        ? new Date(page.updatedAt).toLocaleDateString('zh-CN')
                        : '日期未知'}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
            {!recentPages.length && <p className="space-navigator-empty">暂无笔记</p>}
          </section>
          <section
            className="space-navigator-panel"
            role="tabpanel"
            id={`${id}-panel-plugins`}
            aria-labelledby={`${id}-tab-plugins`}
            hidden={tab !== 'plugins'}
          >
            <ul className="space-navigator-plugins">
              {plugins.map((plugin) => (
                <li key={plugin.id}>
                  <strong>{plugin.name}</strong>
                  <p title={plugin.description}>{plugin.description}</p>
                  <div>
                    <small>{plugin.enabled ? '已启用' : '已停用'}</small>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={plugin.enabled}
                      aria-label={`${plugin.enabled ? '停用' : '启用'}${plugin.name}`}
                      disabled={busy}
                      onClick={() => onTogglePlugin(plugin.id, !plugin.enabled)}
                    >
                      <span />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {!plugins.length && <p className="space-navigator-empty">暂无插件</p>}
          </section>
        </div>
      </details>
    </aside>
  );
}
