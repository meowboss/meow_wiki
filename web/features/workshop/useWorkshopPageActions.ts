import { useEffect, useState } from 'react';
import { api, type WikiPage } from '../../shared/api';
import type { Project, Validation } from './types';

export type CreatedPageTarget = Pick<WikiPage, 'id' | 'title' | 'revision'>;
type Context = {
  project: Project | null;
  validation: Validation | null;
  fileDirty: boolean;
  dirty: boolean;
  running: boolean;
  targetCreatedPage?: CreatedPageTarget;
  action: (key: string, task: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  onInstalled: () => Promise<unknown>;
  reload: (id: string, signal: AbortSignal) => Promise<void>;
  setNotice: (message: string) => void;
  setError: (message: string) => void;
};

export default function useWorkshopPageActions({
  project,
  validation,
  fileDirty,
  dirty,
  running,
  targetCreatedPage,
  action,
  onInstalled,
  reload,
  setNotice,
  setError,
}: Context) {
  const [baseline, setBaseline] = useState(targetCreatedPage);
  useEffect(() => {
    setBaseline((current) => {
      if (!targetCreatedPage || current?.id !== targetCreatedPage.id) return targetCreatedPage;
      // A navigation refresh can still carry the pre-save prop. Never roll back our CAS baseline.
      return targetCreatedPage.revision >= current.revision ? targetCreatedPage : current;
    });
  }, [targetCreatedPage?.id, targetCreatedPage?.title, targetCreatedPage?.revision]);
  const target = baseline?.id === targetCreatedPage?.id ? baseline : targetCreatedPage;
  const canPublish =
    !!project &&
    project.kind === 'page' &&
    !fileDirty &&
    !running &&
    (project.state === 'ready' || validation?.valid);

  function createPage() {
    if (!project || !canPublish) return;
    void action('create-page', async (signal) => {
      const title = window.prompt('新页面标题', project.name)?.trim();
      if (!title) return;
      const page = await api<WikiPage>(
        `/workshop/projects/${encodeURIComponent(project.id)}/create-page`,
        { expectedProjectRevision: project.revision, title },
        'POST',
        signal,
      );
      if (signal.aborted) return;
      setNotice(`${page.title}：已保存为新页面，可从左侧创作页面打开。`);
      try {
        await onInstalled();
      } catch {
        if (!signal.aborted) setError('页面已保存，但导航刷新失败，请手动刷新；不要重复创建。');
      }
    });
  }
  function applyPage() {
    if (!project || !canPublish || targetCreatedPage) return;
    if (!window.confirm(`确认将此项目应用到 ${project.sourceSurface} 页面？当前页面布局将被替换。`))
      return;
    void action('apply', async (signal) => {
      await api(
        `/workshop/projects/${encodeURIComponent(project.id)}/apply`,
        { expectedProjectRevision: project.revision },
        'POST',
        signal,
      );
      if (signal.aborted) return;
      setNotice('页面已应用。项目文件保存与页面应用是独立操作。');
      await onInstalled();
      await reload(project.id, signal);
    });
  }
  function updatePage() {
    if (!project || !target || !canPublish || dirty) return;
    if (!window.confirm(`确认更新创作页面“${target.title}”？当前页面内容将被替换。`)) return;
    void action('update-page', async (signal) => {
      const page = await api<CreatedPageTarget>(
        `/workshop/pages/${encodeURIComponent(target.id)}`,
        {
          expectedRevision: target.revision,
          expectedProjectRevision: project.revision,
          title: target.title,
        },
        'PUT',
        signal,
      );
      if (signal.aborted) return;
      setBaseline({ id: target.id, title: page.title, revision: page.revision });
      setNotice(`${page.title}：创作页面已更新。项目文件保存与页面更新是独立操作。`);
      try {
        await onInstalled();
      } catch {
        if (!signal.aborted) setError('页面已更新，但导航刷新失败，请手动刷新；不要重复更新。');
      }
    });
  }
  return { createPage, applyPage, updatePage, targetCreatedPage: target };
}
