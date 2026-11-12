import type { ComponentProps, ReactNode } from 'react';
import CanvasSurface from '../features/canvas/CanvasSurface';
import { homeCanvasEntries } from '../features/home/HomeComponentView';
import { defaultRegistry } from './canvas-registry';
import type { WorkspaceData } from '../shared/api';
import type { CanvasCatalogEntry } from '../features/canvas/CanvasCatalog';

type WorkspaceCanvasProps = Omit<ComponentProps<typeof CanvasSurface>, 'renderView'> & {
  data?: WorkspaceData;
  onOpen?: (id: string) => void;
  /** Old wiki documents predate the independently removable toolbar instance. */
  wikiDocumentFallbackToolbar?: ReactNode;
  slots: Partial<
    Record<
      | 'wiki.directory'
      | 'wiki.document'
      | 'wiki.header'
      | 'wiki.stats'
      | 'wiki.ask'
      | 'wiki.footer'
      | 'wiki.toolbar'
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
  wikiDocumentFallbackToolbar,
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
                  'wiki.header': '知识空间标题',
                  'wiki.stats': '知识空间统计',
                  'wiki.ask': '知识问答入口',
                  'wiki.footer': '知识空间页脚',
                  'wiki.toolbar': '阅读工具栏',
                  'home.content': '旧首页兼容视图',
                  'collaboration.content': '旧协作兼容视图',
                  'collaboration.header': '协作工具栏',
                  'collaboration.directory': '知识域目录',
                  'collaboration.detail': '知识域详情',
                } as Record<string, string>
              )[viewId] ?? viewId,
            viewId: viewId as CanvasCatalogEntry['viewId'],
            config: viewId === 'wiki.document' ? { splitToolbar: true } : {},
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
      renderView={(instance) =>
        defaultRegistry.render(
          instance,
          {
            data,
            onOpen,
            slots: {
              ...slots,
              'wiki.document': (
                <>
                  {instance.config.splitToolbar !== true && wikiDocumentFallbackToolbar}
                  {slots['wiki.document']}
                </>
              ),
            },
          },
          props.surface,
        )
      }
    />
  );
}
