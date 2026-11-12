import type { PageSurface, Project } from './types';

type Props = {
  project: Project | null;
  projects: Project[];
  working: boolean;
  workspaceId: string | null;
  kind: 'component' | 'page';
  surface: PageSurface;
  fromCurrent: boolean;
  onKindChange: (kind: 'component' | 'page') => void;
  onSurfaceChange: (surface: PageSurface) => void;
  onFromCurrentChange: (value: boolean) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRefresh: () => void;
};
export default function WorkshopProjectPicker({
  project,
  projects,
  working,
  workspaceId,
  kind,
  surface,
  fromCurrent,
  onKindChange,
  onSurfaceChange,
  onFromCurrentChange,
  onSelect,
  onNew,
  onRefresh,
}: Props) {
  return (
    <div className="workshop-project-picker">
      {!project && (
        <>
          <label>
            新建类型
            <select
              value={kind}
              disabled={working}
              onChange={(e) => onKindChange(e.target.value as 'component' | 'page')}
            >
              <option value="component">组件</option>
              <option value="page">页面</option>
            </select>
          </label>
          {kind === 'page' && (
            <>
              <label>
                目标页面
                <select
                  value={surface}
                  disabled={working}
                  onChange={(e) => onSurfaceChange(e.target.value as PageSurface)}
                >
                  <option value="home">首页</option>
                  <option value="wiki">知识库</option>
                  <option value="collaboration">协作</option>
                </select>
              </label>
              <label>
                起始内容
                <select
                  value={fromCurrent ? 'current' : 'blank'}
                  disabled={working}
                  onChange={(e) => onFromCurrentChange(e.target.value === 'current')}
                >
                  <option value="current">从当前页面开始</option>
                  <option value="blank">空白页面</option>
                </select>
              </label>
            </>
          )}
        </>
      )}
      <label>
        选择项目
        <select
          value={project?.id ?? ''}
          disabled={working || !workspaceId}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">新建对话 / 选择已有项目</option>
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <button className="text-btn" disabled={working || !project} onClick={onNew}>
        新建对话
      </button>
      <button className="text-btn" disabled={working || !workspaceId} onClick={onRefresh}>
        刷新项目列表
      </button>
    </div>
  );
}
