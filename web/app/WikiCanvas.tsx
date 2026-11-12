import type { ComponentProps, ReactNode } from 'react';
import WikiReader, { type WikiReaderProps } from '../features/wiki/WikiReader';
import type { WikiWorkspaceCompositionParts } from '../features/wiki/WikiWorkspaceView';
import WorkspaceCanvas from './WorkspaceCanvas';

type Props = Omit<ComponentProps<typeof WorkspaceCanvas>, 'slots' | 'surface'> & {
  parts: WikiWorkspaceCompositionParts;
  directory: ReactNode;
  reader: Omit<WikiReaderProps, 'composition'> | null;
};

/** Keep reader state above the canvas so toolbar and content share one controller. */
export default function WikiCanvas({ parts, directory, reader, ...canvasProps }: Props) {
  const renderCanvas = (toolbar: ReactNode, content: ReactNode) => (
    <div className="wiki-view">
      <WorkspaceCanvas
        {...canvasProps}
        surface="wiki"
        wikiDocumentFallbackToolbar={toolbar}
        slots={{
          'wiki.header': parts.header,
          'wiki.stats': parts.stats,
          'wiki.ask': parts.ask,
          'wiki.footer': parts.footer,
          'wiki.toolbar': toolbar,
          'wiki.directory': directory,
          'wiki.document': (
            <div className="knowledge-space-document">
              {reader ? (
                <section className="wiki-reader" aria-label="页面阅读">
                  {content}
                </section>
              ) : (
                content
              )}
              {parts.empty}
            </div>
          ),
        }}
      />
    </div>
  );

  return reader ? (
    <WikiReader
      {...reader}
      composition={({ toolbar, content }) => renderCanvas(toolbar, content)}
    />
  ) : (
    renderCanvas(null, parts.children)
  );
}
