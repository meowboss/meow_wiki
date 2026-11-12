import type { WorkspaceData } from '../../shared/api';
import ComponentRenderer from '../../shared/components/ComponentRenderer';

export type HomeComponentReference = {
  componentId?: string;
  releaseId?: string;
};

export type HomeCanvasEntry = {
  key: string;
  label: string;
  reference: HomeComponentReference;
};

export function homeCanvasEntries(data: WorkspaceData): HomeCanvasEntry[] {
  return [
    ...data.components.map((component) => ({
      key: `draft:${component.id}`,
      label: `私有 · ${component.name}`,
      reference: { componentId: component.id },
    })),
    ...(data.installed ?? []).map((installed) => ({
      key: `release:${installed.releaseId}`,
      label: `已安装 · ${installed.release.name} v${installed.release.version}`,
      reference: { releaseId: installed.releaseId },
    })),
  ];
}

type Props = {
  data: WorkspaceData;
  reference: HomeComponentReference;
  onOpen: (id: string) => void;
};

export function HomeComponentView({ data, reference, onOpen }: Props) {
  const component =
    reference.releaseId !== undefined
      ? data.installed?.find((installed) => installed.releaseId === reference.releaseId)?.release
      : data.components.find((candidate) => candidate.id === reference.componentId);

  if (!component) {
    return (
      <p className="local-notice" role="status">
        组件已丢失或不可访问。
        {reference.componentId !== undefined && <> 组件 ID：{reference.componentId}。</>}
        {reference.releaseId !== undefined && <> 发布 ID：{reference.releaseId}。</>}
        {reference.componentId === undefined &&
          reference.releaseId === undefined &&
          ' 尚未指定组件引用。'}
      </p>
    );
  }

  return <ComponentRenderer component={component} pages={data.pages} onOpen={onOpen} />;
}

export default HomeComponentView;
