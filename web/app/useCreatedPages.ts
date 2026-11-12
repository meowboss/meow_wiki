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
  const currentWorkspace = useRef(workspaceId);
  currentWorkspace.current = workspaceId;
  const mounted = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    // A mutation from a previous workspace may finish and call its captured reload.
    // Reject it before invalidating the current workspace's in-flight request.
    if (!mounted.current || workspaceId !== currentWorkspace.current) return;
    const version = ++generation.current;
    pending.current?.abort();
    pending.current = null;
    if (!workspaceId) {
      setPages([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    try {
      const result = await api<{ pages: CreatedPageSummary[] }>(
        `/workshop/pages?workspaceId=${encodeURIComponent(workspaceId)}`,
        undefined,
        'GET',
        controller.signal,
      );
      if (!controller.signal.aborted && version === generation.current)
        setPages(result.pages.filter((page) => page.workspaceId === workspaceId));
    } catch {
      if (!controller.signal.aborted && version === generation.current) setPages([]);
    } finally {
      if (!controller.signal.aborted && version === generation.current) {
        pending.current = null;
        setLoading(false);
      }
    }
  }, [workspaceId]);
  useEffect(() => {
    mounted.current = true;
    setPages([]);
    void reload();
    return () => {
      mounted.current = false;
      ++generation.current;
      pending.current?.abort();
      pending.current = null;
    };
  }, [reload]);
  return { pages, loading, reload };
}
