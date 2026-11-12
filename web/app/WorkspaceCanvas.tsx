import type { ComponentProps, ReactNode } from 'react';
import CanvasSurface from '../features/canvas/CanvasSurface';
import HomeComponentView, { homeCanvasEntries } from '../features/home/HomeComponentView';
import CanvasSearchView from '../shared/components/CanvasSearchView';
import type { WorkspaceData } from '../shared/api';

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
