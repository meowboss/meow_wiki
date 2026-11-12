import type { ReactNode } from 'react';

type Props = {
  content: string;
  stale: boolean;
  render?: (content: string) => ReactNode;
};
// The app-owned renderer parses and validates the document before rendering it.
// This feature never imports the canvas feature or the application composition root.
export default function WorkshopPagePreview({ content, stale, render }: Props) {
  return (
    <section className="workshop-preview" aria-label="页面安全预览">
      <h2>页面安全预览</h2>
      {stale && (
        <p className="workshop-warning">当前展示最近保存的页面；未保存 JSON 不进入预览。</p>
      )}
      {render ? (
        render(content)
      ) : (
        <p>页面预览渲染器尚未连接；可在源码中检查页面，项目不会自动应用。</p>
      )}
    </section>
  );
}
