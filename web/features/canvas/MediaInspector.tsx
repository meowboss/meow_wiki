import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../shared/api';
import AssetManager, { type AssetMetadata, encodeBase64, readFile } from './newAssetManager';
import type { CanvasInstance } from './useCanvasComposition';
import './media-inspector.css';

type Props = {
  instance: CanvasInstance;
  workspaceId: string;
  disabled: boolean;
  onChange: (instance: CanvasInstance) => void;
  onBusyChange?: (busy: boolean) => void;
};
type AssetList = { scope: string; assets: AssetMetadata[]; loading: boolean; error: string };
type MediaMutation = { scope: string; controller: AbortController; reader?: FileReader };
const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];

export default function MediaInspector(props: Props) {
  const { instance, workspaceId, disabled } = props;
  const isImage = instance.viewId === 'builtin.image';
  const isVideo = instance.viewId === 'builtin.video';
  const isMedia = isImage || isVideo;
  const scope = JSON.stringify([workspaceId, instance.id, instance.viewId]);
  const latest = useRef(props);
  latest.current = props;
  const mutation = useRef<MediaMutation | null>(null);
  const [operation, setOperation] = useState<'upload' | 'delete' | null>(null);
  const [fileError, setFileError] = useState({ scope, message: '' });
  const [list, setList] = useState<AssetList>({ scope, assets: [], loading: isMedia, error: '' });
  const currentList = list.scope === scope ? list : null;
  const loading = isMedia && (!currentList || currentList.loading);
  const locked = disabled || operation !== null;
  const types = isImage ? IMAGE_TYPES : VIDEO_TYPES;
  const assets = (currentList?.assets ?? []).filter((asset) => types.includes(asset.mime));
  const selectedId = instance.config.assetId ?? '';

  useEffect(() => {
    const controller = new AbortController();
    setList({ scope, assets: [], loading: isMedia && !!workspaceId, error: '' });
    setFileError({ scope, message: '' });
    if (isMedia && workspaceId) {
      void api<{ assets: AssetMetadata[] }>(
        `/assets?workspaceId=${encodeURIComponent(workspaceId)}`,
        undefined,
        'GET',
        controller.signal,
      )
        .then(({ assets: result }) => {
          if (!controller.signal.aborted) {
            setList({ scope, assets: result, loading: false, error: '' });
          }
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setList({
              scope,
              assets: [],
              loading: false,
              error: cause instanceof Error ? cause.message : '媒体素材加载失败。',
            });
          }
        });
    }
    return () => {
      controller.abort();
      const pending = mutation.current;
      if (pending?.scope === scope) {
        mutation.current = null;
        pending.controller.abort();
        if (pending.reader?.readyState === FileReader.LOADING) pending.reader.abort();
        setOperation(null);
        latest.current.onBusyChange?.(false);
      }
    };
  }, [scope, isMedia, workspaceId]);

  function config(patch: Partial<CanvasInstance['config']>) {
    if (latest.current.disabled || mutation.current) return;
    const current = latest.current.instance;
    latest.current.onChange({ ...current, config: { ...current.config, ...patch } });
  }

  async function deleteAsset(asset: AssetMetadata) {
    if (latest.current.disabled || mutation.current || loading || !workspaceId) return;
    if (
      !window.confirm(`确认删除素材“${asset.name}”（${asset.bytes.toLocaleString()} bytes）？
删除不可恢复；若当前未保存的布局使用此素材，成功后会清除该选择。`)
    )
      return;
    if (latest.current.disabled || mutation.current) return;
    const pending: MediaMutation = { scope, controller: new AbortController() };
    mutation.current = pending;
    setOperation('delete');
    setFileError({ scope, message: '' });
    latest.current.onBusyChange?.(true);
    const isCurrent = () =>
      mutation.current === pending &&
      !pending.controller.signal.aborted &&
      latest.current.workspaceId === workspaceId &&
      latest.current.instance.id === instance.id &&
      latest.current.instance.viewId === instance.viewId;
    try {
      await api(
        `/assets/${encodeURIComponent(asset.id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        undefined,
        'DELETE',
        pending.controller.signal,
      );
      if (!isCurrent()) return;
      setList((value) =>
        value.scope === scope
          ? { ...value, assets: value.assets.filter((item) => item.id !== asset.id) }
          : value,
      );
      const current = latest.current.instance;
      if (current.config.assetId === asset.id) {
        latest.current.onChange({ ...current, config: { ...current.config, assetId: undefined } });
      }
    } catch (cause: unknown) {
      if (isCurrent())
        setFileError({
          scope,
          message:
            cause instanceof ApiError && cause.status === 409
              ? '素材仍被已保存的布局引用，请先修改布局并保存，再删除素材。'
              : cause instanceof Error
                ? cause.message
                : '素材删除失败，请重试。',
        });
    } finally {
      if (mutation.current === pending) {
        mutation.current = null;
        setOperation(null);
        latest.current.onBusyChange?.(false);
      }
    }
  }

  async function uploadFile(file: File) {
    if (latest.current.disabled || mutation.current || loading || !workspaceId) return;
    setFileError({ scope, message: '' });
    if (!types.includes(file.type)) {
      setFileError({ scope, message: `请选择支持的${isImage ? '图片' : '视频'}格式。` });
      return;
    }
    if (file.size === 0 || file.size > MAX_BYTES) {
      setFileError({ scope, message: '媒体文件不能为空，且不能超过 8 MiB。' });
      return;
    }
    const reader = new FileReader();
    const pending: MediaMutation = { scope, controller: new AbortController(), reader };
    mutation.current = pending;
    setOperation('upload');
    latest.current.onBusyChange?.(true);
    const isCurrent = () =>
      mutation.current === pending &&
      !pending.controller.signal.aborted &&
      latest.current.workspaceId === workspaceId &&
      latest.current.instance.id === instance.id &&
      latest.current.instance.viewId === instance.viewId;
    try {
      const buffer = await readFile(reader, file);
      if (!isCurrent()) return;
      const asset = await api<AssetMetadata>(
        `/assets?workspaceId=${encodeURIComponent(workspaceId)}`,
        { name: file.name, mime: file.type, base64: encodeBase64(buffer) },
        'POST',
        pending.controller.signal,
      );
      if (!isCurrent()) return;
      setList((value) => ({
        scope,
        assets: [
          ...(value.scope === scope ? value.assets : []).filter((item) => item.id !== asset.id),
          asset,
        ],
        loading: false,
        error: '',
      }));
      const current = latest.current.instance;
      latest.current.onChange({ ...current, config: { ...current.config, assetId: asset.id } });
    } catch (cause: unknown) {
      if (isCurrent()) {
        setFileError({ scope, message: cause instanceof Error ? cause.message : '媒体上传失败。' });
      }
    } finally {
      if (mutation.current === pending) {
        mutation.current = null;
        setOperation(null);
        latest.current.onBusyChange?.(false);
      }
    }
  }

  return (
    <div className="canvas-media-inspector" aria-busy={operation !== null}>
      <label>
        组件图层
        <select
          value={instance.layer ?? 'content'}
          disabled={locked}
          onChange={(event) => {
            if (latest.current.disabled || mutation.current) return;
            const layer = event.target.value;
            if (layer === 'background' || layer === 'content' || layer === 'overlay') {
              latest.current.onChange({ ...latest.current.instance, layer });
            }
          }}
        >
          <option value="background">背景</option>
          <option value="content">内容</option>
          <option value="overlay">悬浮</option>
        </select>
      </label>
      {isMedia && (
        <>
          <label>
            媒体素材
            <select
              value={selectedId}
              disabled={locked || loading || !workspaceId}
              onChange={(event) => config({ assetId: event.target.value || undefined })}
            >
              <option value="">{loading ? '正在加载素材…' : '未选择（清除素材）'}</option>
              {selectedId && !assets.some((asset) => asset.id === selectedId) && (
                <option value={selectedId} disabled>
                  当前素材不可用
                </option>
              )}
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}（{(asset.bytes / 1024).toFixed(1)} KiB）
                </option>
              ))}
            </select>
          </label>
          <AssetManager
            assets={currentList?.assets ?? []}
            selectedId={selectedId}
            disabled={locked || loading || !workspaceId}
            onDelete={(asset) => void deleteAsset(asset)}
          />
          <label>
            上传媒体素材
            <input
              type="file"
              accept={types.join(',')}
              disabled={locked || loading || !workspaceId}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void uploadFile(file);
              }}
            />
          </label>
          <p className="canvas-media-inspector-hint">
            仅使用当前空间的媒体素材，每个文件最多 8 MiB；媒体不支持任意 URL。
          </p>
          {operation && (
            <p className="canvas-media-inspector-hint" role="status">
              {operation === 'upload' ? '媒体上传中…' : '素材删除中…'}
            </p>
          )}
          {currentList?.error && (
            <p className="canvas-media-inspector-error" role="alert">
              {currentList.error}
            </p>
          )}
          {fileError.scope === scope && fileError.message && (
            <p className="canvas-media-inspector-error" role="alert">
              {fileError.message}
            </p>
          )}
          <label>
            {isImage ? '图片替代文本' : '视频说明'}
            <input
              type="text"
              maxLength={300}
              value={instance.config.alt ?? ''}
              disabled={locked}
              onChange={(event) => config({ alt: event.target.value })}
            />
          </label>
        </>
      )}
      {isVideo && (
        <div className="canvas-media-inspector-options">
          {(
            [
              ['muted', '静音', true],
              ['autoplay', '自动播放', false],
              ['loop', '循环', false],
            ] as const
          ).map(([key, label, fallback]) => (
            <label className="canvas-checkbox" key={key}>
              <input
                type="checkbox"
                checked={instance.config[key] ?? fallback}
                disabled={locked}
                onChange={(event) => config({ [key]: event.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      )}
      {instance.viewId === 'builtin.pet' && (
        <label>
          桌宠字符
          <input
            type="text"
            maxLength={20}
            value={instance.config.text ?? ''}
            disabled={locked}
            onChange={(event) => config({ text: event.target.value.slice(0, 20) })}
          />
        </label>
      )}
    </div>
  );
}
