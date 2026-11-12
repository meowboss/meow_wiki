import { useMemo } from 'react';
import type { WikiPage } from '../../shared/api';
import type { SpaceNavigatorProps } from './SpaceNavigator';

type Props = Pick<
  SpaceNavigatorProps,
  'pages' | 'trash' | 'plugins' | 'busy' | 'selectedId' | 'onOpen' | 'onRestore' | 'onTogglePlugin'
> & { onShowPages: () => void };

function updatedTime(page: WikiPage) {
  const value = Date.parse(page.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

export default function SpaceManagement({
  pages,
  trash,
  plugins,
  busy,
  selectedId,
  onOpen,
  onRestore,
  onTogglePlugin,
  onShowPages,
}: Props) {
  const recentPages = useMemo(
    () => [...pages].sort((a, b) => updatedTime(b) - updatedTime(a)).slice(0, 5),
    [pages],
  );
  const topLevelCount = useMemo(() => pages.filter((page) => !page.parentId).length, [pages]);

  return (
    <div className="space-management">
      <section aria-label="空间概览">
        <h3>空间概览</h3>
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
        <button className="space-navigator-create" type="button" onClick={onShowPages}>
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
      <details className="space-management-section">
        <summary>插件配置</summary>
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
      </details>
      <details className="space-management-section">
        <summary>回收站 · {trash.length}</summary>
        <ul className="space-navigator-trash">
          {trash.map((page) => (
            <li key={page.id}>
              <span>{page.title || '未命名笔记'}</span>
              <button type="button" disabled={busy} onClick={() => onRestore(page.id)}>
                恢复
              </button>
            </li>
          ))}
        </ul>
        {!trash.length && <p className="space-navigator-empty">回收站为空</p>}
      </details>
    </div>
  );
}
