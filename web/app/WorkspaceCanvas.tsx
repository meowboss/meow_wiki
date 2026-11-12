import type { ComponentProps, ReactNode } from 'react';
import CanvasSurface from '../features/canvas/CanvasSurface';
import HomeComponentView, { homeCanvasEntries } from '../features/home/HomeComponentView';
import CanvasSearchView from '../shared/components/CanvasSearchView';
import type { WorkspaceData } from '../shared/api';
import type { CanvasCatalogEntry } from '../features/canvas/CanvasCatalog';

type WorkspaceCanvasProps = Omit<ComponentProps<typeof CanvasSurface>, 'renderView'> & {
  data?: WorkspaceData;
  onOpen?: (id: string) => void;
  slots: Partial<
    Record<
      | 'wiki.directory'
      | 'wiki.document'
      | 'home.content'
      | 'collaboration.content'
      | 'collaboration.header'
      | 'collaboration.directory'
      | 'collaboration.detail',
      ReactNode
    >
  >;
};

/** App composition owns business views; the canvas only owns their placement. */
export default function WorkspaceCanvas({
  slots,
  data,
  onOpen = () => {},
  ...props
}: WorkspaceCanvasProps) {
  return (
    <CanvasSurface
      {...props}
      availableViews={[
        { label: '文本', viewId: 'builtin.text', config: { text: '新文本' } },
        { label: '搜索笔记', viewId: 'builtin.search', config: {} },
        ...Object.entries(slots)
          .filter(([viewId, node]) => node != null && viewId !== 'collaboration.content')
          .map(([viewId]) => ({
            label:
              (
                {
                  'wiki.directory': '笔记目录',
                  'wiki.document': '笔记正文',
                  'home.content': '旧首页兼容视图',
                  'collaboration.content': '旧协作兼容视图',
                  'collaboration.header': '协作工具栏',
                  'collaboration.directory': '知识域目录',
                  'collaboration.detail': '知识域详情',
                } as Record<string, string>
              )[viewId] ?? viewId,
            viewId: viewId as CanvasCatalogEntry['viewId'],
            config: {},
          })),
      ]}
      catalog={
        data
          ? homeCanvasEntries(data).map((entry) => ({
              label: entry.label,
              viewId: 'component.render' as const,
              config: entry.reference,
            }))
          : []
      }
      renderView={(instance) => {
        switch (instance.viewId) {
          case 'component.render':
            return data ? (
              <HomeComponentView data={data} reference={instance.config} onOpen={onOpen} />
            ) : (
              <p>当前空间数据未就绪</p>
            );
          case 'builtin.search':
            return <CanvasSearchView onOpen={onOpen} />;
          case 'wiki.directory':
          case 'wiki.document':
          case 'home.content':
          case 'collaboration.content':
          case 'collaboration.header':
          case 'collaboration.directory':
          case 'collaboration.detail':
            return slots[instance.viewId] ?? null;
          default:
            // CanvasSurface renders builtin.text itself.
            return null;
        }
      }}
    />
  );
}
