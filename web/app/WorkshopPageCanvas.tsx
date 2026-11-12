import { useMemo } from 'react';
import { parsePageProjectContent } from '../../packages/workshop-contract/index';
import CanvasPreview from '../features/canvas/CanvasPreview';
import { defaultRegistry } from './canvas-registry';
import type { WorkspaceData } from '../shared/api';
import CanvasDirectoryView from '../shared/components/CanvasDirectoryView';
import { api } from '../shared/api';
import { useEffect, useState } from 'react';
/** Application-owned data adapter. The workshop feature never imports business features. */
export default function WorkshopPageCanvas({
  content,
  data,
  ownerId,
  workspaceId,
}: {
  content: string;
  data?: WorkspaceData;
  ownerId: string;
  workspaceId: string;
}) {
  const parsed = useMemo(() => parsePageProjectContent(content), [content]);
  const [html, setHtml] = useState('');
  const [selected, setSelected] = useState('');
  const page = data?.pages.find((p) => p.id === selected) ?? data?.pages[0];
  useEffect(() => {
    const controller = new AbortController();
    setHtml('');
    if (page)
      void api<{ html: string }>('/render', { markdown: page.markdown }, 'POST', controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setHtml(value.html);
        })
        .catch(() => {});
    return () => controller.abort();
  }, [page?.id, page?.markdown]);
  if (!parsed.success) return <p role="status">页面源码尚未通过校验；请修正后预览。</p>;
  const directory = (
    <CanvasDirectoryView
      pages={data?.pages ?? []}
      onOpen={setSelected}
      config={{ text: '空间笔记' }}
    />
  );
  const slots = {
    'wiki.header': (
      <header>
        <h1>{data?.workspace.name ?? parsed.data.name}</h1>
        <p>页面工作副本 · 不修改原页面</p>
      </header>
    ),
    'wiki.stats': <p>{data?.pages.length ?? 0} 篇授权笔记</p>,
    'wiki.directory': directory,
    'wiki.document': page ? (
      <section className="wiki-reader">
        <article className="wiki-reader-article">
          <h1>{page.title}</h1>
          {html ? (
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <pre>{page.markdown}</pre>
          )}
        </article>
      </section>
    ) : (
      <p>当前空间没有笔记。</p>
    ),
    'wiki.toolbar': <p>阅读工具栏 · 预览不提供正文写入</p>,
    'wiki.ask': <p>知识问答入口 · 预览不提交请求</p>,
    'wiki.footer': <small>Meow Wiki · 页面预览</small>,
    'home.header': <h1>{parsed.data.name}</h1>,
    'home.controls': <p>首页组合设置 · 预览只读</p>,
    'home.content': directory,
    'collaboration.header': <h1>知识协作</h1>,
    'collaboration.directory': <p>协作目录 · 需显式选择授权领域</p>,
    'collaboration.detail': <p>这里预览界面布局，不读取未授权协作内容。</p>,
  };
  return (
    <CanvasPreview
      ownerId={ownerId}
      workspaceId={workspaceId}
      composition={parsed.data.composition}
      renderView={(instance) =>
        defaultRegistry.render(
          instance,
          { data, onOpen: setSelected, slots },
          parsed.data.composition.surface,
        )
      }
    />
  );
}
