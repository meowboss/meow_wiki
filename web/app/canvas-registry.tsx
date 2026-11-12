import type { ReactNode } from 'react';
import type { CanvasInstance, CanvasSurface } from '../../packages/canvas-contract/index';
import HomeComponentView from '../features/home/HomeComponentView';
import type { WorkspaceData } from '../shared/api';
import CanvasDirectoryView from '../shared/components/CanvasDirectoryView';
import CanvasSearchView from '../shared/components/CanvasSearchView';

/** Rendering accepts future trusted IDs independently of persisted contract validation. */
export type CanvasViewInstance = Omit<CanvasInstance, 'viewId'> & { viewId: string };

export type CanvasRenderContext = {
  data?: WorkspaceData;
  onOpen: (id: string) => void;
  slots: Record<string, ReactNode>;
};

/** Only application-owned code supplies render functions; document config is inert data. */
export type CanvasViewRegistration = {
  readonly id: string;
  readonly render: (instance: CanvasViewInstance, ctx: CanvasRenderContext) => ReactNode;
  readonly surfaces?: readonly CanvasSurface[];
};

export type CanvasRegistry = {
  readonly registrations: readonly CanvasViewRegistration[];
  readonly get: (id: string) => CanvasViewRegistration | undefined;
  readonly render: (
    instance: CanvasViewInstance,
    ctx: CanvasRenderContext,
    surface?: CanvasSurface,
  ) => ReactNode;
};

function unavailableView(id: string): ReactNode {
  return (
    <p className="local-notice" role="status">
      画布视图不可用：{id}
    </p>
  );
}

/** Private Map, copied immutable registrations, and no process-wide mutable registration API. */
export function createCanvasRegistry(
  registrations: readonly CanvasViewRegistration[],
): CanvasRegistry {
  const views = new Map<string, CanvasViewRegistration>();
  for (const registration of registrations) {
    if (views.has(registration.id)) {
      throw new Error(`Duplicate canvas view registration: ${registration.id}`);
    }
    views.set(
      registration.id,
      Object.freeze({
        ...registration,
        ...(registration.surfaces ? { surfaces: Object.freeze([...registration.surfaces]) } : {}),
      }),
    );
  }
  return Object.freeze({
    registrations: Object.freeze([...views.values()]),
    get: (id: string) => views.get(id),
    render: (
      instance: CanvasViewInstance,
      ctx: CanvasRenderContext,
      surface?: CanvasSurface,
    ): ReactNode => {
      const registration = views.get(instance.viewId);
      if (
        !registration ||
        (surface !== undefined &&
          registration.surfaces !== undefined &&
          !registration.surfaces.includes(surface))
      ) {
        return unavailableView(instance.viewId);
      }
      return registration.render(instance, ctx);
    },
  });
}

/** Every slot uses the same renderer; new trusted slots need only a registration. */
export function createSlotCanvasRegistration(
  id: string,
  surfaces?: readonly CanvasSurface[],
): CanvasViewRegistration {
  return {
    id,
    surfaces,
    render: (instance, ctx) =>
      Object.hasOwn(ctx.slots, instance.viewId) ? (ctx.slots[instance.viewId] ?? null) : null,
  };
}

/** Text and media are owned by CanvasInstanceFrame and deliberately absent here. */
export const coreCanvasRegistrations: readonly CanvasViewRegistration[] = createCanvasRegistry([
  {
    id: 'builtin.search',
    render: (_instance, ctx) => <CanvasSearchView onOpen={ctx.onOpen} />,
  },
  {
    id: 'builtin.directory',
    render: (instance, ctx) => (
      <CanvasDirectoryView
        pages={ctx.data?.pages ?? []}
        config={instance.config}
        onOpen={ctx.onOpen}
      />
    ),
  },
  {
    id: 'component.render',
    render: (instance, ctx) =>
      ctx.data ? (
        <HomeComponentView data={ctx.data} reference={instance.config} onOpen={ctx.onOpen} />
      ) : (
        <p>当前空间数据未就绪</p>
      ),
  },
  ...[
    'wiki.directory',
    'wiki.document',
    'wiki.header',
    'wiki.stats',
    'wiki.ask',
    'wiki.footer',
    'wiki.toolbar',
  ].map((id) => createSlotCanvasRegistration(id, ['wiki'])),
  createSlotCanvasRegistration('home.content', ['home']),
  ...[
    'collaboration.content',
    'collaboration.header',
    'collaboration.directory',
    'collaboration.detail',
  ].map((id) => createSlotCanvasRegistration(id, ['collaboration'])),
]).registrations;

export const defaultRegistry = createCanvasRegistry(coreCanvasRegistrations);
export default defaultRegistry;
