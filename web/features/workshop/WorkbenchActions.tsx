import type { Project, Validation } from './types';

type Props = {
  project: Project;
  validation: Validation | null;
  working: boolean;
  fileDirty: boolean;
  onValidate: () => void;
  onInstall: () => void;
  onApply: () => void;
};
export default function WorkbenchActions({
  project,
  validation,
  working,
  fileDirty,
  onValidate,
  onInstall,
  onApply,
}: Props) {
  const page = project.kind === 'page';
  return (
    <section
      className="workshop-editor"
      aria-label={page ? '页面校验与应用' : '组件保存与高级编辑'}
    >
      {project.error && (
        <p className="form-error" role="alert">
          执行错误：{project.error}
        </p>
      )}
      <div className="workshop-actions">
        <button className="secondary-btn" disabled={working || fileDirty} onClick={onValidate}>
          {page ? '校验页面' : '校验组件'}
        </button>
        <button
          className="primary-btn"
          disabled={working || fileDirty || !(project.state === 'ready' || validation?.valid)}
          onClick={page ? onApply : onInstall}
        >
          {page ? '应用到页面' : '保存为私有组件'}
        </button>
      </div>
      <p>
        {page
          ? `目标页面：${project.sourceSurface ?? '未知'}。对话与文件保存不会自动应用；应用前需要明确确认。`
          : '保存与公开发布分开。完成对话不会自动上架；你可先预览并继续发消息修改。'}
      </p>
      {validation && (
        <div
          className={validation.valid ? 'workshop-validation-success' : 'workshop-validation-error'}
          role="status"
        >
          <strong>{validation.valid ? '校验通过' : '校验未通过'}</strong>
          {validation.issues && (
            <pre className="workshop-issues">{JSON.stringify(validation.issues, null, 2)}</pre>
          )}
        </div>
      )}
    </section>
  );
}
