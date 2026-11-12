import { useEffect, useState } from 'react';
import { api, type SearchResult } from '../api';
export default function CanvasSearchView({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState(''),
    [items, setItems] = useState<SearchResult[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    setError('');
    if (!query.trim()) return () => controller.abort();
    const timer = setTimeout(() => {
      void api<{ results: SearchResult[] }>(
        `/search?q=${encodeURIComponent(query.trim())}`,
        undefined,
        'GET',
        controller.signal,
      )
        .then((value) => {
          if (!controller.signal.aborted) setItems(value.results);
        })
        .catch(() => {
          if (!controller.signal.aborted) setError('搜索暂不可用，请检查空间插件设置。');
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return (
    <section aria-label="画布搜索">
      <label>
        搜索笔记
        <input
          aria-label="画布搜索笔记"
          value={query}
          maxLength={500}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {items.map((item) => (
        <button
          type="button"
          className="search-result"
          key={item.id}
          onClick={() => onOpen(item.id)}
        >
          {item.title}
        </button>
      ))}
    </section>
  );
}
