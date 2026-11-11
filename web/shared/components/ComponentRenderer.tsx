import { useEffect, useState } from 'react';
import {
  api,
  type ComponentBlock,
  type SearchResult,
  type WikiComponent,
  type WikiPage,
} from '../api';

const errorText = (e: unknown) => (e instanceof Error ? e.message : '请求失败');
function MarkdownBlock({ text }: { text: string }) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    setHtml('');
    setError('');
    void api<{ html: string }>('/render', { markdown: text }, 'POST', c.signal)
      .then((r) => {
        if (!c.signal.aborted) setHtml(r.html);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      });
    return () => c.abort();
  }, [text]);
  return error ? (
    <p role="alert" className="form-error">
      {error}
    </p>
  ) : (
    <div className="markdown-body component-markdown" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
function SearchBlock({ title, onOpen }: { title: string; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setResults([]);
    setError('');
    setLoading(false);
    if (!query.trim()) return;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api<{ results: SearchResult[] }>(
        `/search?q=${encodeURIComponent(query.trim())}`,
        undefined,
        'GET',
        c.signal,
      )
        .then((r) => {
          if (!c.signal.aborted) setResults(r.results);
        })
        .catch((e) => {
          if (!c.signal.aborted) setError(errorText(e));
        })
        .finally(() => {
          if (!c.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      c.abort();
    };
  }, [query]);
  return (
    <section className="component-block">
      <h3>{title || '搜索当前空间'}</h3>
      <label className="field">
        搜索当前工作空间
        <input
          aria-label={title || '组件搜索'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={500}
        />
      </label>
      {loading && <p role="status">搜索中…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {results.map((r) => (
        <button className="search-result" key={r.id} onClick={() => onOpen(r.id)}>
          <span>
            <strong>{r.title}</strong>
            <small>{r.excerpt}</small>
          </span>
        </button>
      ))}
      {query.trim() && !loading && !error && !results.length && <p>没有找到相关页面。</p>}
    </section>
  );
}
function Block({
  block,
  pages,
  onOpen,
}: {
  block: ComponentBlock;
  pages: WikiPage[];
  onOpen: (id: string) => void;
}) {
  if (block.type === 'markdown') return <MarkdownBlock text={block.text} />;
  if (block.type === 'search') return <SearchBlock title={block.title} onOpen={onOpen} />;
  if (block.type === 'page-list')
    return (
      <section className="component-block">
        <h3>{block.title || '当前空间页面'}</h3>
        {pages.length ? (
          pages.map((p) => (
            <button className="search-result" key={p.id} onClick={() => onOpen(p.id)}>
              {p.title || '无标题页面'}
            </button>
          ))
        ) : (
          <p>当前工作空间暂无页面。</p>
        )}
      </section>
    );
  return <p className="local-notice">暂不支持此组件区块，已安全跳过。</p>;
}
export default function ComponentRenderer({
  component,
  pages,
  onOpen,
}: {
  component: WikiComponent;
  pages: WikiPage[];
  onOpen: (id: string) => void;
}) {
  const blocks = component.blocks ?? [{ type: 'markdown' as const, text: component.template }];
  return (
    <div className="component-renderer">
      {blocks.length ? (
        blocks.map((block, i) => <Block key={i} block={block} pages={pages} onOpen={onOpen} />)
      ) : (
        <p>此组件尚未配置区块。</p>
      )}
    </div>
  );
}
