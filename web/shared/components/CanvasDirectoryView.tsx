import { useId } from 'react';
import { useInstanceSessionState } from '../canvas-instance-session';
import type { WikiPage } from '../api';

interface CanvasDirectoryViewProps {
  pages: WikiPage[];
  onOpen: (id: string) => void;
  config: { text?: string };
}

export default function CanvasDirectoryView({ pages, onOpen, config }: CanvasDirectoryViewProps) {
  const [query, setQuery] = useInstanceSessionState('directory.query', '');
  const id = useId();
  const title = config.text ?? '笔记目录';
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredPages = pages.filter((page) =>
    page.title.toLocaleLowerCase().includes(normalizedQuery),
  );

  return (
    <section className="canvas-directory-view" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <label htmlFor={`${id}-filter`}>目录筛选</label>
      <input
        id={`${id}-filter`}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p role="status">
        {normalizedQuery
          ? `显示 ${filteredPages.length} / ${pages.length} 篇笔记`
          : `共 ${pages.length} 篇笔记`}
      </p>
      {filteredPages.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {filteredPages.map((page) => (
            <li key={page.id}>
              <button type="button" onClick={() => onOpen(page.id)}>
                {page.title || '未命名笔记'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{pages.length === 0 ? '暂无笔记' : '没有匹配的笔记'}</p>
      )}
    </section>
  );
}
