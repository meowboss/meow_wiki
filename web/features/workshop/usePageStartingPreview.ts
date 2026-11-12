import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import {
  createDefaultComposition,
  type Composition,
} from '../../../packages/canvas-contract/index';
import type { PageSurface } from './types';
export default function usePageStartingPreview({
  enabled,
  workspaceId,
  surface,
  fromCurrent,
}: {
  enabled: boolean;
  workspaceId: string | null;
  surface: PageSurface;
  fromCurrent: boolean;
}) {
  const [state, setState] = useState<{
    key: string;
    content: string;
    loading: boolean;
    error: string;
  }>({ key: '', content: '', loading: false, error: '' });
  const key = `${workspaceId}:${surface}:${fromCurrent}`;
  useEffect(() => {
    if (!enabled || !workspaceId) return;
    const controller = new AbortController();
    setState({ key, content: '', loading: true, error: '' });
    const request = fromCurrent
      ? api<Composition>(
          `/compositions/${surface}?workspaceId=${encodeURIComponent(workspaceId)}`,
          undefined,
          'GET',
          controller.signal,
        )
      : Promise.resolve({ ...createDefaultComposition(surface), instances: [] });
    void request
      .then(({ revision: _, ...composition }) => {
        if (!controller.signal.aborted)
          setState({
            key,
            content: JSON.stringify({
              format: 'meow.page',
              version: 1,
              name: '当前页面预览',
              composition,
            }),
            loading: false,
            error: '',
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            key,
            content: '',
            loading: false,
            error: '无法加载当前页面预览，请切换页面或重试；未创建任何项目。',
          });
      });
    return () => controller.abort();
  }, [enabled, workspaceId, surface, fromCurrent, key]);
  return state.key === key ? state : { key, content: '', loading: enabled, error: '' };
}
