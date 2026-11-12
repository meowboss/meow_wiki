import { useMemo } from 'react';
import type { ComponentBlock, WikiComponent, WikiPage } from '../../shared/api';
import ComponentRenderer from '../../shared/components/ComponentRenderer';

// Preview only the same bounded declarative shape accepted by the workshop.
function previewComponent(content: string): WikiComponent | null {
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    if (
      Object.keys(data).some(
        (key) => !['name', 'description', 'template', 'blocks'].includes(key),
      ) ||
      typeof data.name !== 'string' ||
      !data.name.trim() ||
      data.name.length > 160 ||
      typeof data.description !== 'string' ||
      data.description.length > 500 ||
      typeof data.template !== 'string' ||
      data.template.length > 10000
    )
      return null;
    let blocks: ComponentBlock[] | undefined;
    if (data.blocks !== undefined) {
      if (!Array.isArray(data.blocks) || data.blocks.length > 20) return null;
      blocks = [];
      for (const item of data.blocks) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        if (
          item.type === 'markdown' &&
          typeof item.text === 'string' &&
          item.text.length <= 10000 &&
          Object.keys(item).every((key) => key === 'type' || key === 'text')
        )
          blocks.push({ type: 'markdown', text: item.text });
        else if (
          (item.type === 'page-list' || item.type === 'search') &&
          typeof item.title === 'string' &&
          item.title.length <= 160 &&
          Object.keys(item).every((key) => key === 'type' || key === 'title')
        )
          blocks.push({ type: item.type, title: item.title });
        else return null;
      }
    }
    return {
      id: 'workshop-preview',
      name: data.name,
      description: data.description,
      template: data.template,
      blocks,
      status: 'private',
      authorId: '',
      version: 1,
    };
  } catch {
    return null;
  }
}
export default function WorkshopPreview({
  content,
  pages,
  onOpen,
  stale,
}: {
  content: string;
  pages: WikiPage[];
  onOpen: (id: string) => void;
  stale: boolean;
}) {
  const component = useMemo(() => previewComponent(content), [content]);
  return (
    <section className="workshop-preview" aria-labelledby="workshop-preview-title">
      <h2 id="workshop-preview-title">安全预览</h2>
      <p>只读取当前授权工作空间；预览不等于保存或发布。</p>
      {stale && (
        <p className="workshop-warning">
          当前展示最近保存的文件；运行结束后会刷新，未保存 JSON 不进入预览。
        </p>
      )}
      {component ? (
        <>
          <h3>{component.name}</h3>
          <p>{component.description}</p>
          <ComponentRenderer component={component} pages={pages} onOpen={onOpen} />
        </>
      ) : (
        <p>尚无可安全预览的完整组件。请继续对话，待产物校验就绪。</p>
      )}
    </section>
  );
}
