import type { CanvasInstance, CanvasSurfaceName } from './useCanvasComposition';

export type CanvasCatalogEntry = {
  label: string;
  viewId: CanvasInstance['viewId'];
  config: CanvasInstance['config'];
};
type ViewMetadata = CanvasCatalogEntry & {
  repeatable: boolean;
  surfaces?: readonly CanvasSurfaceName[];
};

const views: readonly ViewMetadata[] = [
  { label: '文本', viewId: 'builtin.text', config: { text: '在此输入文本' }, repeatable: true },
  { label: '搜索', viewId: 'builtin.search', config: {}, repeatable: true },
  {
    label: '可重复笔记目录',
    viewId: 'builtin.directory',
    config: { text: '笔记目录' },
    repeatable: true,
  },
  { label: '图片 / 背景', viewId: 'builtin.image', config: { alt: '图片' }, repeatable: true },
  {
    label: '视频播放器',
    viewId: 'builtin.video',
    config: { muted: true, loop: false },
    repeatable: true,
  },
  { label: '页面桌宠', viewId: 'builtin.pet', config: { text: '🐈' }, repeatable: true },
  {
    label: '知识目录',
    viewId: 'wiki.directory',
    config: {},
    repeatable: false,
    surfaces: ['wiki'],
  },
  { label: '知识文档', viewId: 'wiki.document', config: {}, repeatable: false, surfaces: ['wiki'] },
  { label: '首页内容', viewId: 'home.content', config: {}, repeatable: false, surfaces: ['home'] },
  {
    label: '协作标题',
    viewId: 'collaboration.header',
    config: {},
    repeatable: false,
    surfaces: ['collaboration'],
  },
  {
    label: '协作目录',
    viewId: 'collaboration.directory',
    config: {},
    repeatable: false,
    surfaces: ['collaboration'],
  },
  {
    label: '协作详情',
    viewId: 'collaboration.detail',
    config: {},
    repeatable: false,
    surfaces: ['collaboration'],
  },
  {
    label: '协作内容',
    viewId: 'collaboration.content',
    config: {},
    repeatable: false,
    surfaces: ['collaboration'],
  },
  { label: '空间组件', viewId: 'component.render', config: {}, repeatable: true },
];

export function isRepeatableView(viewId: CanvasInstance['viewId']): boolean {
  return views.some((view) => view.viewId === viewId && view.repeatable);
}

export function isViewOnSurface(
  viewId: CanvasInstance['viewId'],
  surface: CanvasSurfaceName,
): boolean {
  return views.some(
    (view) => view.viewId === viewId && (!view.surfaces || view.surfaces.includes(surface)),
  );
}

/** App-supplied entries describe mounted business slots and retain their own config. */
export function availableCanvasViews(
  surface: CanvasSurfaceName,
  availableViews?: readonly CanvasCatalogEntry[],
): CanvasCatalogEntry[] {
  const builtins = views.filter((view) => view.viewId.startsWith('builtin.'));
  const candidates =
    availableViews ??
    views.filter(
      (view) => view.surfaces?.includes(surface) && view.viewId !== 'collaboration.content',
    );
  const entries = new Map<CanvasInstance['viewId'], CanvasCatalogEntry>();
  for (const view of [...builtins, ...candidates]) {
    if (view.viewId !== 'component.render' && isViewOnSurface(view.viewId, surface)) {
      entries.set(view.viewId, {
        label: view.label,
        viewId: view.viewId,
        config: { ...view.config },
      });
    }
  }
  return [...entries.values()];
}
