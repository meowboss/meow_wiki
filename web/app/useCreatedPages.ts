import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../shared/api';
export type CreatedPageSummary = {
  id: string;
  title: string;
  revision: number;
  workspaceId: string;
};
export default function useCreatedPages(workspaceId: string | null) {
  const [pages, setPages] = useState<CreatedPageSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const version = ++generation.current;
    if (!workspaceId) {
      setPages([]);
      return;
    }
    setLoading(true);
    try {
      const result = await api<{ pages: CreatedPageSummary[] }>(
        `/workshop/pages?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      if (version === generation.current) setPages(result.pages);
    } catch {
      if (version === generation.current) setPages([]);
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, [workspaceId]);
  useEffect(() => {
    setPages([]);
    void reload();
    return () => {
      ++generation.current;
    };
  }, [reload]);
  return { pages, loading, reload };
}
