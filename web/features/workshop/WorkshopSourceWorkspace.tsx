import WorkshopSource from './WorkshopSource';
import WorkshopRevisionHistory from './WorkshopRevisionHistory';
import './revision-history.css';
import type { Project } from './types';
type Props = {
  project: Project;
  path: string;
  file: string;
  content: string;
  working: boolean;
  dirty: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
};
export default function WorkshopSourceWorkspace({
  project,
  path,
  file,
  content,
  working,
  dirty,
  onChange,
  onSave,
}: Props) {
  return (
    <>
      <WorkshopSource
        path={path || file}
        content={!path || path === file ? content : (project.files[path] ?? '')}
        editable={!path || path === file}
        page={project.kind === 'page'}
        working={working}
        dirty={dirty}
        onChange={onChange}
        onSave={onSave}
      />
      <WorkshopRevisionHistory
        project={project}
        currentContent={content}
        disabled={working}
        onRestoreDraft={onChange}
      />
    </>
  );
}
