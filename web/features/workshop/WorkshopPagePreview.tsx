import { useRef, type ReactNode } from 'react';
import { parsePageProjectContent } from '../../../packages/workshop-contract/index';
type Props = {
  content: string;
  stale: boolean;
  projectId: string;
  render?: (content: string) => ReactNode;
};
/** Last valid source is local to this project; invalid drafts never replace the running preview. */
export default function WorkshopPagePreview({ content, stale, projectId, render }: Props) {
  const previous = useRef<{ projectId: string; content: string } | null>(null);
  if (previous.current?.projectId !== projectId) previous.current = null;
  const valid = parsePageProjectContent(content).success;
  if (valid) previous.current = { projectId, content };
  const shown = valid ? content : previous.current?.content;
  return (
    <section className="workshop-preview" aria-label="页面安全预览">
      <h2>页面安全预览</h2>
      {stale && (
        <p className="workshop-warning">当前展示最近保存的页面；未保存 JSON 不进入预览。</p>
      )}
      {!valid && (
        <p role="status">
          当前源码未通过校验；
          {shown ? '保留上一次有效预览，不代表当前源码。' : '尚无有效页面可预览。'}
        </p>
      )}
      {shown && render ? (
        render(shown)
      ) : !render ? (
        <p>页面预览渲染器尚未连接；可在源码中检查页面，项目不会自动应用。</p>
      ) : null}
    </section>
  );
}
