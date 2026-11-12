import { useEffect, useState } from 'react';
import { api, type WorkspaceData } from '../shared/api';
import WorkshopPageCanvas from './WorkshopPageCanvas';
import type { CompositionDocument } from '../../packages/canvas-contract/index';
export default function CreatedPageView({
  id,
  workspaceId,
  ownerId,
  data,
  onEdit,
}: {
  id: string;
  workspaceId: string;
  ownerId: string;
  data?: WorkspaceData;
  onEdit: (target: { id: string; title: string; revision: number; projectId: string }) => void;
}) {
  const [page, setPage] = useState<{
    id: string;
    title: string;
    workspaceId: string;
    composition: CompositionDocument;
    revision: number;
    sourceProject: string | null;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setError('');
    void api<typeof page>(
      `/workshop/pages/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      undefined,
      'GET',
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted && value?.workspaceId === workspaceId) setPage(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('无法读取创作页面，请刷新页面列表后重试。');
      });
    return () => controller.abort();
  }, [id, workspaceId]);
  if (error) return <p role="alert">{error}</p>;
  if (!page) return <p role="status">正在加载创作页面…</p>;
  return (
    <section aria-label="创作页面">
      <h1>{page.title}</h1>
      <button
        type="button"
        disabled={!page.sourceProject}
        onClick={() =>
          page.sourceProject &&
          onEdit({
            id: page.id,
            title: page.title,
            revision: page.revision,
            projectId: page.sourceProject,
          })
        }
      >
        在工坊继续编辑
      </button>
      <WorkshopPageCanvas
        ownerId={ownerId}
        workspaceId={workspaceId}
        data={data}
        content={JSON.stringify({
          format: 'meow.page',
          version: 1,
          name: page.title,
          composition: page.composition,
        })}
      />
    </section>
  );
}
