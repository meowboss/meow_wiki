import { useEffect, useRef, useState } from 'react';
import type { CanvasInstance } from './useCanvasComposition';
import './media-views.css';
import { useCanvasActive } from './runtime-context';
import { useInstanceSessionState } from '../../shared/canvas-instance-session';

type MediaConfig = {
  assetId?: string;
  text?: string;
  alt?: string;
  muted?: boolean;
  autoplay?: boolean;
  loop?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assetSource(assetId: string | undefined, workspaceId: string) {
  if (!assetId || !UUID.test(assetId) || !workspaceId) return null;
  return `/api/assets/${encodeURIComponent(assetId)}/content?workspaceId=${encodeURIComponent(workspaceId)}`;
}

function useReducedMotion() {
  // Stay still until the user's browser preference is known (including during SSR).
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function Placeholder({ children }: { children: string }) {
  return (
    <div className="canvas-media-placeholder" role="status">
      {children}
    </div>
  );
}

function ImageView({ source, alt }: { source: string; alt: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  return (
    <div className="canvas-media-image" data-state={state} aria-busy={state === 'loading'}>
      {state === 'loading' && <Placeholder>图片加载中…</Placeholder>}
      {state === 'error' ? (
        <Placeholder>{alt ? `图片无法加载：${alt}` : '图片无法加载。'}</Placeholder>
      ) : (
        <img
          className="canvas-media-image-content"
          src={source}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
        />
      )}
    </div>
  );
}

function VideoView({ source, config }: { source: string; config: MediaConfig }) {
  const active = useCanvasActive();
  const video = useRef<HTMLVideoElement>(null);
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(() => typeof document !== 'undefined' && !document.hidden);
  const [failed, setFailed] = useState(false);
  const muted = config.muted ?? true;
  const autoplay = active && config.autoplay === true && muted && !reducedMotion && visible;
  useEffect(() => {
    if (!active) video.current?.pause();
  }, [active]);

  useEffect(() => {
    const element = video.current;
    const visibilityChanged = () => {
      setVisible(!document.hidden);
      if (document.hidden) element?.pause();
    };
    visibilityChanged();
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged);
      element?.pause();
    };
  }, []);

  useEffect(() => {
    if (config.autoplay && reducedMotion) video.current?.pause();
  }, [config.autoplay, reducedMotion]);

  return (
    <div className="canvas-media-video">
      <video
        ref={video}
        className="canvas-media-video-content"
        src={source}
        controls
        playsInline
        muted={muted}
        loop={config.loop ?? false}
        autoPlay={autoplay}
        preload="metadata"
        aria-label={config.alt || '画布视频'}
        onPlay={(event) => {
          if (document.hidden || !active) event.currentTarget.pause();
        }}
        onError={() => setFailed(true)}
      >
        当前浏览器无法播放此视频。
      </video>
      {failed && (
        <Placeholder>视频无法播放，请检查资源是否可用或浏览器是否支持此格式。</Placeholder>
      )}
    </div>
  );
}

function PetView({ config }: { config: MediaConfig }) {
  const active = useCanvasActive();
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useInstanceSessionState('pet.paused', false);
  const [greetings, setGreetings] = useInstanceSessionState('pet.greetings', 0);
  const character = config.text?.trim() || '🐈';
  return (
    <div className="canvas-media-pet" data-paused={paused || reducedMotion || !active}>
      <button
        type="button"
        className="canvas-media-pet-character"
        aria-label={config.alt || '和桌宠打招呼'}
        onClick={() => setGreetings((count) => count + 1)}
      >
        <span aria-hidden="true">{character}</span>
      </button>
      <button
        type="button"
        className="canvas-media-pet-pause"
        aria-pressed={paused || reducedMotion}
        disabled={reducedMotion}
        onClick={() => setPaused((value) => !value)}
      >
        {reducedMotion ? '已减少动态效果' : paused ? '继续桌宠动画' : '暂停桌宠动画'}
      </button>
      <span className="canvas-media-pet-greeting" role="status" aria-live="polite">
        {greetings > 0 && (greetings % 2 ? '喵～很高兴见到你！' : '喵～我在这里陪你。')}
      </span>
    </div>
  );
}

export default function CanvasMediaView({
  instance,
  workspaceId,
}: {
  instance: CanvasInstance;
  workspaceId: string;
}) {
  const config: MediaConfig = instance.config;
  const viewId = instance.viewId;
  if (viewId === 'builtin.pet') return <PetView key={instance.id} config={config} />;
  if (viewId !== 'builtin.image' && viewId !== 'builtin.video') return null;
  const source = assetSource(config.assetId, workspaceId);
  if (!source) {
    return (
      <Placeholder>
        {viewId === 'builtin.image' ? '请选择图片资源。' : '请选择视频资源。'}
      </Placeholder>
    );
  }
  return viewId === 'builtin.image' ? (
    <ImageView key={source} source={source} alt={config.alt ?? '画布图片'} />
  ) : (
    <VideoView key={source} source={source} config={config} />
  );
}
