import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createDefaultComposition,
  type Composition,
} from '../../../packages/canvas-contract/index';
import { api, ApiError } from '../../shared/api';
import {
  canvasDraftKey,
  clearCanvasDraft,
  readCanvasDraft,
  saveCanvasDraft,
  type CanvasDraft,
} from './draft-storage';

export type CanvasInstance = Composition['instances'][number];
export type CanvasSurfaceName = Composition['surface'];
const same = (a: Composition | null, b: Composition | null) =>
  JSON.stringify(a) === JSON.stringify(b);

export function useCanvasComposition(
  surface: CanvasSurfaceName,
  workspaceId: string,
  onDirtyChange: (value: boolean) => void,
  onBusyChange: (value: boolean) => void,
  ownerId: string,
) {
  const [baseline, setBaseline] = useState<Composition | null>(null);
  const [draft, setDraft] = useState<Composition | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [past, setPast] = useState<Composition[]>([]);
  const [future, setFuture] = useState<Composition[]>([]);
  const [reload, setReload] = useState(0);
  const [recovery, setRecovery] = useState<CanvasDraft | null>(null);
  const [baseRevision, setBaseRevision] = useState(0);
  const [loadedScope, setLoadedScope] = useState('');
  const scope = { ownerId, workspaceId, surface };
  const scopeKey = canvasDraftKey(scope);
  const [stateScope, setStateScope] = useState(scopeKey);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const callbacks = useRef({ onDirtyChange, onBusyChange });
  callbacks.current = { onDirtyChange, onBusyChange };
  const dirty = stateScope === scopeKey && editing && !same(baseline, draft);
  useEffect(() => {
    callbacks.current.onDirtyChange(dirty);
  }, [dirty]);
  useEffect(() => {
    callbacks.current.onBusyChange(busy);
  }, [busy]);
  useEffect(
    () => () => {
      callbacks.current.onDirtyChange(false);
      callbacks.current.onBusyChange(false);
    },
    [],
  );
  const path = `/compositions/${surface}?workspaceId=${encodeURIComponent(workspaceId)}`;

  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    request.current?.abort();
    request.current = controller;
    const fallback = createDefaultComposition(surface);
    setStateScope(scopeKey);
    setLoaded(false);
    setLoadedScope('');
    setRecovery(null);
    setBaseline(null);
    setDraft(fallback);
    setEditing(false);
    setPast([]);
    setFuture([]);
    setError('');
    setConflict(false);
    setBusy(true);
    void api<Composition>(path, undefined, 'GET', controller.signal)
      .then((value) => {
        if (controller.signal.aborted || version !== generation.current) return;
        setLoaded(true);
        setLoadedScope(scopeKey);
        setBaseRevision(value.revision);
        setBaseline(value);
        setDraft(value);
        setRecovery(readCanvasDraft({ ownerId, workspaceId, surface }));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && version === generation.current) {
          setBaseline(fallback);
          setError('布局加载失败，已使用临时默认布局；重新加载后才能保存，业务内容仍可使用。');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && version === generation.current) setBusy(false);
      });
    return () => {
      controller.abort();
      ++generation.current;
      request.current?.abort();
    };
  }, [path, reload, ownerId, scopeKey, surface, workspaceId]);

  useEffect(() => {
    // A scope switch renders once with the old state before the loading effect runs.
    // Never persist that state into the next owner's storage slot.
    if (!loaded || loadedScope !== scopeKey || busy || !editing || !draft || recovery) return;
    if (!dirty) {
      clearCanvasDraft({ ownerId, workspaceId, surface });
      return;
    }
    saveCanvasDraft(
      { ownerId, workspaceId, surface },
      { composition: draft, baseRevision, savedAt: Date.now() },
    );
  }, [
    loaded,
    loadedScope,
    scopeKey,
    busy,
    dirty,
    editing,
    draft,
    recovery,
    baseRevision,
    ownerId,
    workspaceId,
    surface,
  ]);

  const change = useCallback(
    (next: Composition) => {
      if (!draft || same(draft, next)) return;
      setPast((items) => [...items, draft].slice(-20));
      setFuture([]);
      setDraft(next);
    },
    [draft],
  );
  function undo() {
    if (!draft || !past.length) return;
    setFuture((items) => [draft, ...items].slice(0, 20));
    setDraft(past[past.length - 1]);
    setPast(past.slice(0, -1));
  }
  function redo() {
    if (!draft || !future.length) return;
    setPast((items) => [...items, draft].slice(-20));
    setDraft(future[0]);
    setFuture(future.slice(1));
  }
  function recoverDraft() {
    if (!recovery || !baseline || busy || !loaded || loadedScope !== scopeKey) return;
    setDraft(recovery.composition);
    setBaseRevision(recovery.baseRevision);
    setEditing(true);
    setPast([]);
    setFuture([]);
    const stale = recovery.baseRevision !== baseline.revision;
    setConflict(stale);
    setError(stale ? '草稿基于较旧的布局版本，已保留但无法保存。请导出草稿或放弃后重新编辑。' : '');
    setRecovery(null);
  }
  function discardDraft() {
    clearCanvasDraft(scope);
    setRecovery(null);
    setDraft(baseline);
    setBaseRevision(baseline?.revision ?? 0);
    setEditing(false);
    setPast([]);
    setFuture([]);
    setError('');
    setConflict(false);
  }
  function cancel() {
    clearCanvasDraft(scope);
    setRecovery(null);
    setBaseRevision(baseline?.revision ?? 0);
    setDraft(baseline);
    setEditing(false);
    setPast([]);
    setFuture([]);
    setError('');
    setConflict(false);
  }
  function restore() {
    if (!draft || (dirty && !window.confirm('恢复默认布局将替换当前未保存的布局，是否继续？')))
      return;
    change({ ...createDefaultComposition(surface), revision: draft.revision });
  }
  async function save() {
    if (!draft || !baseline || busy || conflict || !loaded || loadedScope !== scopeKey) return;
    const controller = new AbortController();
    request.current = controller;
    const version = generation.current;
    const { revision: _revision, ...composition } = draft;
    setBusy(true);
    setError('');
    try {
      const value = await api<Composition>(
        path,
        { expectedRevision: baseline.revision, composition },
        'PUT',
        controller.signal,
      );
      if (controller.signal.aborted || version !== generation.current) return;
      clearCanvasDraft(scope);
      setRecovery(null);
      setBaseRevision(value.revision);
      setBaseline(value);
      setDraft(value);
      setEditing(false);
      setPast([]);
      setFuture([]);
    } catch (cause) {
      if (controller.signal.aborted || version !== generation.current) return;
      const stale = cause instanceof ApiError && cause.status === 409;
      setConflict(stale);
      setError(
        stale
          ? '布局已被其他会话修改。当前草稿已保留，请重新加载最新布局后再编辑。'
          : cause instanceof Error
            ? cause.message
            : '布局保存失败',
      );
    } finally {
      if (!controller.signal.aborted && version === generation.current) setBusy(false);
    }
  }
  async function migrateLegacy() {
    if (surface !== 'home' || busy || !baseline || !loaded) return;
    if (
      !window.confirm(
        '将旧首页布局转换为独立画布实例？旧首页与组件内容不修改，新画布将按当前版本保存。',
      )
    )
      return;
    if (dirty && !window.confirm('当前布局草稿将被迁移结果替换，继续吗？')) return;
    const controller = new AbortController();
    request.current = controller;
    const version = generation.current;
    setBusy(true);
    setError('');
    try {
      const value = await api<Composition>(
        `/compositions/home/migrate-legacy?workspaceId=${encodeURIComponent(workspaceId)}`,
        { expectedRevision: baseline.revision },
        'POST',
        controller.signal,
      );
      if (controller.signal.aborted || version !== generation.current) return;
      clearCanvasDraft(scope);
      setRecovery(null);
      setBaseRevision(value.revision);
      setBaseline(value);
      setDraft(value);
      setEditing(false);
      setPast([]);
      setFuture([]);
    } catch (cause) {
      if (!controller.signal.aborted && version === generation.current)
        setError(cause instanceof Error ? cause.message : '迁移失败，原数据保留');
    } finally {
      if (!controller.signal.aborted && version === generation.current) setBusy(false);
    }
  }
  function loadLatest() {
    if (dirty && !window.confirm('重新加载会放弃当前布局草稿，是否继续？')) return;
    setReload((value) => value + 1);
  }
  return {
    draft: stateScope === scopeKey ? draft : null,
    editing: stateScope === scopeKey && editing,
    setEditing,
    busy,
    dirty,
    error,
    conflict,
    loaded,
    hasRecovery: loaded && loadedScope === scopeKey && recovery !== null,
    recoverDraft,
    discardDraft,
    change,
    cancel,
    restore,
    save,
    loadLatest,
    migrateLegacy,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
