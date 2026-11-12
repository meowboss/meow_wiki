import { renderMarkdown } from './markdown.ts';
import { Kernel, type SearchPage, type SearchResult } from '../kernel.ts';

function search(query: string, pages: SearchPage[]): SearchResult[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean).slice(0, 16);
  if (!terms.length) return [];
  return pages
    .map((page) => {
      const title = page.title.toLocaleLowerCase();
      const body = page.markdown.toLocaleLowerCase();
      const score = terms.reduce(
        (sum, term) => sum + (title.includes(term) ? 3 : 0) + (body.includes(term) ? 1 : 0),
        0,
      );
      const position = Math.max(0, body.indexOf(terms[0]) - 45);
      return {
        id: page.id,
        title: page.title,
        excerpt: page.markdown.slice(position, position + 220),
        score,
      };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ score: _score, ...result }) => result);
}
export function createKernel() {
  const kernel = new Kernel();
  kernel.register({
    manifest: {
      id: 'official.markdown',
      name: 'Markdown 工坊',
      description: '安全渲染 Markdown，让知识清晰成形。',
      version: '0.1.0',
      apiVersion: 1,
      kind: 'renderer',
      requires: [],
    },
    setup: (register) => register('render', renderMarkdown),
  });
  kernel.register({
    manifest: {
      id: 'official.search',
      name: '知识检索',
      description: '当前 Wiki 内的轻量关键词检索。',
      version: '0.1.0',
      apiVersion: 1,
      kind: 'search',
      requires: [],
    },
    setup: (register) => register('search', search),
  });
  kernel.register({
    manifest: {
      id: 'official.llm-wiki',
      name: 'LLM Wiki',
      description: '引用优先的问答入口；当前为本地摘录模式，不调用模型。',
      version: '0.1.0',
      apiVersion: 1,
      kind: 'assistant',
      requires: ['official.search'],
    },
    setup: (register) =>
      register('ask', (question, pages) => {
        const sources = search(question, pages).slice(0, 3);
        return {
          mode: 'local-extractive',
          answer: sources.length
            ? sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.excerpt}`).join('\n\n')
            : '当前知识库没有匹配的内容。请尝试页面中的关键词；尚未配置语言模型，不会编造答案。',
          sources,
        };
      }),
  });
  return kernel;
}
